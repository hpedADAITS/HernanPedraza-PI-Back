// Stateful per-socket match session.
//
// Why this exists
// ---------------
// The previous streaming path (audio.js → RamMatcher.match) emitted a
// fresh `audio_match_update` every ~700 ms and let the front-end figure
// out what was stable. The result was a UI that flickered "match found,
// match found, match found" and that ignored what was happening in the
// queue (PENDING song approved? DJ already sent a different track?).
//
// MatchSession turns the streaming matcher into a small state machine:
//
//   idle ──── chunk with confident top match ────► holding
//   holding ── holdWindowMs elapsed without swap ──► locked
//   holding ── top match swaps (different trackId) ──► holding (new candidate)
//   holding ── DJ sent a different track now        ──► released
//   locked  ── DJ sent a different track now         ──► released
//   any     ── explicit reset()                      ──► idle
//
// The session is fed three inputs:
//
//   1. addChunk(hashes)   — every audio chunk the socket processes.
//   2. applyQueueEvent(e) — when the server emits song_suggested /
//                            song_approved / song_now_playing / etc.
//                            The event room is fanned out to every
//                            socket, so the session hears it too.
//   3. applyDjIntent(trackId) — when a DJ explicitly sends a track
//                            now (sendMatchedTrackNow). The hold/lock
//                            respects the DJ's choice instead of
//                            overwriting it.
//
// The session is also the single place that knows what a "match
// transition" means — it returns a list of diffs every input so the
// socket handler can decide which socket events to emit. That keeps
// the protocol additive and the diffs testable.

const { isConfidentWinner, resolveThresholds, evaluateAbsoluteGates } = require('./match-thresholds');
const {
  enrichMatchesWithQueueContext,
  bindRecognitionMatchToPendingSong,
  findUpNextQueueTrack,
} = require('./queue-linker');
const { logger } = require('../../utils');

const STATE = Object.freeze({
  IDLE: 'idle',
  HOLDING: 'holding',
  LOCKED: 'locked',
  RELEASED: 'released',
});

const EVENT = Object.freeze({
  CANDIDATE: 'candidate',
  HOLD_STARTED: 'hold_started',
  HOLD_UPDATED: 'hold_updated',
  LOCKED: 'locked',
  RELEASED: 'released',
  QUEUE_UPDATED: 'queue_updated',
  IDLE: 'idle',
});

// Queue events that move a song out of PLAYING. When the locked
// candidate's song receives one of these, the lock is no longer
// meaningful and the matcher should wake up to re-lock onto whatever
// is actually playing next.
const PLAYING_LEAVE_EVENTS = new Set(['song_skipped', 'song_rejected', 'song_played']);

class MatchSession {
  constructor({ eventId, ramMatcher, options = {} } = {}) {
    if (!eventId) throw new Error('MatchSession requires an eventId');
    if (!ramMatcher) throw new Error('MatchSession requires a ramMatcher');

    this.eventId = String(eventId);
    this.ramMatcher = ramMatcher;
    this.options = options;

    const base = resolveThresholds();
    this.holdWindowMs = Number.isFinite(options.holdWindowMs) ? options.holdWindowMs : base.holdWindowMs;
    this.minPersistentChunks = Number.isFinite(options.minPersistentChunks)
      ? options.minPersistentChunks
      : base.minPersistentChunks;
    this.minMatchQueryHashes = Number.isFinite(options.minMatchQueryHashes)
      ? options.minMatchQueryHashes
      : base.minMatchQueryHashes;
    this.reMatchDebounceMs = Number.isFinite(options.reMatchDebounceMs)
      ? options.reMatchDebounceMs
      : base.reMatchDebounceMs;
    this.confidenceOverrides = options.confidenceOverrides || null;

    this.state = STATE.IDLE;
    this.accumulatedHashes = [];
    this.hashesByTrackId = new Map();
    this.candidate = null;
    this.holdStartedAt = 0;
    this.persistentChunks = 0;
    this.lastChunkAt = 0;
    this.lastDiff = null;
    this.djLockedTrackId = null;
    this.queueSnapshot = { queue: [], nowPlaying: null };
  }

  // Reset the session to idle. Called when the socket match session
  // stops or the event ends.
  reset() {
    const wasLocked = this.state === STATE.LOCKED || this.state === STATE.HOLDING;
    const previousTrackId = this.candidate?.trackId;
    this.state = STATE.IDLE;
    this.accumulatedHashes = [];
    this.hashesByTrackId = new Map();
    this.candidate = null;
    this.holdStartedAt = 0;
    this.persistentChunks = 0;
    this.lastChunkAt = 0;
    this.djLockedTrackId = null;
    if (wasLocked) {
      return [this._makeDiff(EVENT.RELEASED, { trackId: previousTrackId, reason: 'reset' })];
    }
    return [];
  }

  // Feed the session the hashes from one streaming chunk. Returns a
  // list of diffs the socket layer can act on.
  async addChunk(hashes) {
    if (this.state === STATE.LOCKED) return [];
    if (!Array.isArray(hashes) || hashes.length === 0) {
      return [];
    }
    const cleanHashes = sanitizeHashes(hashes);
    if (!cleanHashes.length) return [];

    this.lastChunkAt = Date.now();
    this.accumulatedHashes.push(...cleanHashes);

    const diffs = [];
    const ranked = this.ramMatcher.match(this.eventId, this.accumulatedHashes);
    const enriched = await enrichMatchesWithQueueContext(this.eventId, ranked);
    const verdict = isConfidentWinner(enriched, this.confidenceOverrides);
    const top = verdict.winner;
    const totalHashes = this.accumulatedHashes.length;

    if (!top) {
      // No candidate at all. If we were locked, release. If we were
      // holding, the hold also dies — there is nothing to wait for.
      diffs.push(...this._dropCandidate('no_candidate'));
      this.lastDiff = diffs;
      return diffs;
    }

    // Below the minimum hash count, we are still warming up. Do not
    // promote or release; just remember the candidate so persistence
    // can build up.
    if (totalHashes < this.minMatchQueryHashes) {
      diffs.push(...this._maybeStartHold(top, enriched, { warming: true }));
      this.lastDiff = diffs;
      return diffs;
    }

    diffs.push(...this._maybeStartHold(top, enriched, { warming: false }));

    // After enough consistent chunks, the hold becomes a lock.
    if (
      this.state === STATE.HOLDING &&
      this.candidate &&
      this.candidate.trackId === top.trackId &&
      this.persistentChunks >= this.minPersistentChunks &&
      Date.now() - this.holdStartedAt >= this.holdWindowMs
    ) {
      diffs.push(...this._lock());
    }

    this.lastDiff = diffs;
    return diffs;
  }

  // Re-evaluate the lock condition without taking new hashes. Useful
  // for the re-match debounce: the socket layer can call this on a
  // timer to advance the hold → lock transition without waiting for
  // the next chunk. Returns a fresh diff list (possibly empty).
  async reEvaluate() {
    if (this.state === STATE.LOCKED) return [];
    if (this.accumulatedHashes.length === 0) return [];
    return this.addChunk([]);
  }

  // Apply a queue event the server broadcast (song_suggested,
  // song_approved, song_now_playing, song_rejected, song_skipped).
  // The session reacts by:
  //   - refreshing the queue context on the current candidate
  //   - releasing the lock when the candidate song transitions out of
  //     PLAYING (skip / reject / end-of-track) so recognition wakes up
  //   - releasing the hold if a different song became PLAYING
  //     (the DJ has decided what plays next)
  async applyQueueEvent(event) {
    if (!event || typeof event !== 'object') return [];
    const type = String(event.type || event.event || '');
    if (!type) return [];

    const diffs = [];
    const eventTrackId = event.trackId ? String(event.trackId) : null;

    const target = await findUpNextQueueTrack(this.eventId);
    if (this.candidate) {
      const candidateIsPlaying = Boolean(this.candidate.queueContext?.hasPlaying);
      if (
        target?.trackId &&
        String(target.trackId) !== String(this.candidate.trackId) &&
        !candidateIsPlaying
      ) {
        diffs.push(
          ...this._dropCandidate('queue_target_changed', {
            targetTrackId: target.trackId,
            targetSongId: target.songId,
          }),
        );
      } else if (!target?.trackId && this.state !== STATE.LOCKED && !candidateIsPlaying) {
        diffs.push(...this._dropCandidate('no_queue_target'));
      }
    }

    if (
      type === 'song_now_playing' &&
      eventTrackId &&
      this.candidate &&
      eventTrackId !== this.candidate.trackId
    ) {
      diffs.push(
        ...this._dropCandidate('dj_sent_different_track', {
          conflictingTrackId: eventTrackId,
          conflictingSongId: event.songId,
        }),
      );
    } else if (type === 'song_now_playing' && eventTrackId === this.candidate?.trackId) {
      // Our candidate is now actually playing. Promote the lock to a
      // confirmed play (no separate event needed; the song_now_playing
      // broadcast already covers it).
      if (this.state !== STATE.LOCKED) {
        diffs.push(...this._lock({ confirmedByQueue: true }));
      }
    } else if (
      this.candidate &&
      this.state === STATE.LOCKED &&
      this.candidate.queueContext?.hasPlaying &&
      PLAYING_LEAVE_EVENTS.has(type) &&
      eventTrackId &&
      eventTrackId === this.candidate.trackId
    ) {
      // The song we were locked on just left PLAYING (skipped,
      // rejected, or marked played). The lock no longer represents
      // anything real — release so the matcher can wake up and lock
      // onto the next thing that's actually playing.
      diffs.push(
        ...this._dropCandidate('candidate_left_playing', {
          previousStatus: this.candidate.queueContext?.playing?.status || 'PLAYING',
          trigger: type,
        }),
      );
    }

    // For any queue event, refresh the queue context of the current
    // candidate so the UI sees the latest status.
    if (this.candidate) {
      const enriched = await enrichMatchesWithQueueContext(this.eventId, [this.candidate]);
      if (enriched[0]) {
        const before = this.candidate.queueContext;
        this.candidate = { ...this.candidate, ...enriched[0] };
        if (
          this.state === STATE.LOCKED &&
          !this.candidate.queueContext?.hasPlaying &&
          !this.candidate.queueContext?.hasApproved
        ) {
          diffs.push(this._dropCandidate('candidate_left_queue')[0]);
          this.lastDiff = diffs;
          return diffs;
        }
        if (queueContextChanged(before, this.candidate.queueContext)) {
          diffs.push(this._makeDiff(EVENT.QUEUE_UPDATED, { trackId: this.candidate.trackId }));
        }
      }
    }

    this.lastDiff = diffs;
    return diffs;
  }

  // Called when the DJ / phone microphone explicitly sends a track
  // now (sendMatchedTrackNow). This is the strongest form of "DJ
  // intent" — the hold should bow out and let the DJ's choice stand.
  applyDjIntent(trackId) {
    const intentTrackId = trackId ? String(trackId) : null;
    if (!intentTrackId) return [];
    this.djLockedTrackId = intentTrackId;

    if (!this.candidate) return [];
    if (intentTrackId === this.candidate.trackId) {
      // The DJ confirmed our candidate. Promote the lock.
      if (this.state !== STATE.LOCKED) {
        const diffs = this._lock({ confirmedByDj: true });
        this.lastDiff = diffs;
        return diffs;
      }
      return [];
    }
    // DJ picked something else. Drop our hold.
    const diffs = this._dropCandidate('dj_intent_other_track', { djTrackId: intentTrackId });
    this.lastDiff = diffs;
    return diffs;
  }

  // Optional side effect: when the session locks, attempt to bind the
  // trackId to any PENDING song that has a matching title/artist. The
  // bind is a no-op if no PENDING song matches, so calling it is safe
  // but never required.
  async maybeBindLockedSong() {
    if (this.state !== STATE.LOCKED || !this.candidate) return null;
    return bindRecognitionMatchToPendingSong(this.eventId, this.candidate.trackId, {
      source: 'match-session',
    });
  }

  getState() {
    return {
      state: this.state,
      candidate: this.candidate ? summarizeCandidate(this.candidate) : null,
      holdStartedAt: this.holdStartedAt || null,
      persistentChunks: this.persistentChunks,
      accumulatedHashes: this.accumulatedHashes.length,
      holdWindowMs: this.holdWindowMs,
      minPersistentChunks: this.minPersistentChunks,
      minMatchQueryHashes: this.minMatchQueryHashes,
    };
  }

  // ---- internal state transitions ---------------------------------------

  _maybeStartHold(top, enrichedList, { warming } = {}) {
    const diffs = [];
    const enriched = enrichedList.find((m) => m.trackId === top.trackId) || {
      ...top,
      queueContext: emptyQueueContext(top.trackId),
    };

    if (this.candidate && this.candidate.trackId === top.trackId) {
      // Same candidate, update its score / queue context.
      this.candidate = { ...this.candidate, ...enriched };
      this.persistentChunks += 1;
      if (this.state === STATE.HOLDING) {
        diffs.push(this._makeDiff(EVENT.HOLD_UPDATED, summarizeCandidate(this.candidate)));
      } else if (this.state === STATE.IDLE && !warming) {
        this.state = STATE.HOLDING;
        this.holdStartedAt = Date.now();
        diffs.push(this._makeDiff(EVENT.HOLD_STARTED, summarizeCandidate(this.candidate)));
      }
      return diffs;
    }

    // Track change. Drop the old candidate (if any) and start a new
    // hold for the new top. The persistence counter resets to 1 (this
    // chunk counts as the first observation).
    if (this.candidate) {
      diffs.push(this._makeDiff(EVENT.RELEASED, {
        trackId: this.candidate.trackId,
        reason: 'top_match_changed',
        newTopTrackId: top.trackId,
      }));
    }

    this.candidate = { ...enriched };
    this.persistentChunks = 1;
    this.state = warming ? STATE.IDLE : STATE.HOLDING;
    this.holdStartedAt = warming ? 0 : Date.now();
    diffs.push(
      this._makeDiff(warming ? EVENT.CANDIDATE : EVENT.HOLD_STARTED, summarizeCandidate(this.candidate)),
    );
    return diffs;
  }

  _lock({ confirmedByDj = false, confirmedByQueue = false } = {}) {
    if (!this.candidate) return [];
    if (this.state === STATE.LOCKED) return [];
    this.state = STATE.LOCKED;
    this.candidate = { ...this.candidate, lockedAt: Date.now() };
    logger.info('Match session locked', {
      eventId: this.eventId,
      trackId: this.candidate.trackId,
      score: this.candidate.score,
      confirmedByDj,
      confirmedByQueue,
    });
    return [this._makeDiff(EVENT.LOCKED, summarizeCandidate(this.candidate))];
  }

  _dropCandidate(reason, extra = {}) {
    if (!this.candidate) {
      if (this.state !== STATE.IDLE) {
        this.state = STATE.IDLE;
        return [this._makeDiff(EVENT.IDLE, { reason })];
      }
      return [];
    }
    const previous = summarizeCandidate(this.candidate);
    this.candidate = null;
    this.persistentChunks = 0;
    this.holdStartedAt = 0;
    this.state = STATE.IDLE;
    return [this._makeDiff(EVENT.RELEASED, { ...previous, reason, ...extra })];
  }

  _makeDiff(event, payload) {
    return {
      event,
      state: this.state,
      timestamp: Date.now(),
      payload,
    };
  }
}

// ---- helpers -------------------------------------------------------------

function sanitizeHashes(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    if (!item) continue;
    const hash = Number(item.hash ?? item.h);
    const time = Number(item.time ?? item.t);
    if (!Number.isFinite(hash) || !Number.isFinite(time)) continue;
    out.push({ hash, time });
  }
  return out;
}

function summarizeCandidate(candidate) {
  if (!candidate) return null;
  return {
    trackId: candidate.trackId,
    title: candidate.title,
    artist: candidate.artist,
    coverUrl: candidate.coverUrl || null,
    duration: candidate.duration || 0,
    score: candidate.score,
    totalAligned: candidate.totalAligned,
    offsetConcentration: candidate.offsetConcentration,
    offset: candidate.offset,
    queueContext: candidate.queueContext || emptyQueueContext(candidate.trackId),
    lockedAt: candidate.lockedAt || null,
  };
}

function emptyQueueContext(trackId) {
  return {
    trackId,
    hasMatch: false,
    isInQueue: false,
    hasPending: false,
    hasApproved: false,
    hasPlaying: false,
    pending: null,
    nextApproved: null,
    approvedCount: 0,
    playing: null,
    isPlayableNow: false,
    suggestedAction: 'no_queue_entry',
  };
}

function queueContextChanged(a, b) {
  if (!a || !b) return Boolean(a) !== Boolean(b);
  return (
    a.hasPending !== b.hasPending ||
    a.hasApproved !== b.hasApproved ||
    a.hasPlaying !== b.hasPlaying ||
    a.isPlayableNow !== b.isPlayableNow ||
    a.suggestedAction !== b.suggestedAction ||
    JSON.stringify(a.nextApproved || null) !== JSON.stringify(b.nextApproved || null) ||
    JSON.stringify(a.playing || null) !== JSON.stringify(b.playing || null) ||
    JSON.stringify(a.pending || null) !== JSON.stringify(b.pending || null)
  );
}

module.exports = {
  MatchSession,
  STATE,
  EVENT,
};
