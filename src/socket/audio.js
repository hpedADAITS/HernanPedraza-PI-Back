// Audio fingerprinting handlers (live phone-microphone path).
// Split from socket/events.js so the audio DSP, transport, and broadcast
// concerns are isolated from business logic.

const { logger } = require('../utils');
const { EventModel } = require('../models/schema');
const { ackSuccess, ackError } = require('./ack');
const { audioTracksService, sharedRamMatcher, songsService } = require('../services');
const {
  TARGET_SAMPLE_RATE,
  resampleLinear,
} = require('../services/audio-recognition/wav');
const { StreamingFingerprinter } = require('../services/audio-recognition/streaming');
const { isValidId } = require('./shared-validators');
const { MatchSession, EVENT: SESSION_EVENT, STATE: SESSION_STATE } = require('../services/audio-recognition/match-session');
const matchSessionRegistry = require('../services/audio-recognition/match-session-registry');
const { toEventRoom } = require('./rooms');

// Events the match session listens to. These are server-broadcast
// events fanned out to the whole event room, so we hook them via the
// session's applyQueueEvent() from a single subscription per socket.
const QUEUE_EVENT_NAMES = [
  'song_suggested',
  'song_approved',
  'song_rejected',
  'song_skipped',
  'song_now_playing',
  'queue_updated',
];

const LIVE_MATCH_OPTIONS = {
  holdWindowMs: 1800,
  minPersistentChunks: 2,
};

async function resolveAudioEventId(eventId) {
  if (isValidId(eventId)) return String(eventId);
  const event = await EventModel.findOne({ eventId: String(eventId || '').toUpperCase() })
    .select('_id')
    .lean();
  if (!event) throw new Error('Invalid event ID');
  return event._id.toString();
}

async function assertAudioEventAccess(socket, eventId) {
  const eventObjectId = await resolveAudioEventId(eventId);
  if (socket.user?.type === 'phone-microphone') {
    if (socket.user.eventId !== eventObjectId) throw new Error('Invalid phone microphone token');
    return eventObjectId;
  }
  await audioTracksService.listTracks(eventObjectId, socket.user);
  return eventObjectId;
}

function extractFloat32Pcm(payload) {
  if (payload instanceof Float32Array) return payload;
  if (payload instanceof ArrayBuffer) return new Float32Array(payload);
  if (Buffer.isBuffer(payload)) {
    if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Invalid Float32 PCM byte length: ${payload.byteLength}`);
    }
    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }
  if (ArrayBuffer.isView(payload)) {
    if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Invalid typed PCM byte length: ${payload.byteLength}`);
    }
    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }
  throw new Error(`Unsupported audio chunk payload: ${typeof payload}`);
}

function emitMatchDiff(socket, io, eventId, diff) {
  if (!diff) return;
  const base = { eventId, timestamp: new Date().toISOString() };
  const emitLegacyUpdate = (matches) => {
    const update = { ...base, matches };
    socket.emit('audio_match_update', update);
    if (io) toEventRoom(io, eventId).emit('audio_match_update', update);
  };

  // Map session diff events to socket-level events. We keep the legacy
  // `audio_match_update` event for the simplest "top match" payload so
  // the existing front-end reducer continues to receive something it
  // can render. The new stateful events (audio_match_hold,
  // audio_match_locked, audio_match_released) carry the queue context.
  const queueContext = diff.payload?.queueContext;

  switch (diff.event) {
    case SESSION_EVENT.CANDIDATE:
      socket.emit('audio_match_candidate', {
        ...base,
        state: diff.state,
        candidate: diff.payload,
      });
      emitLegacyUpdate([toLegacyMatch(diff.payload)]);
      break;
    case SESSION_EVENT.HOLD_STARTED:
      socket.emit('audio_match_hold', {
        ...base,
        state: diff.state,
        candidate: diff.payload,
        holdStartedAt: Date.now(),
      });
      emitLegacyUpdate([toLegacyMatch(diff.payload)]);
      break;
    case SESSION_EVENT.HOLD_UPDATED:
      socket.emit('audio_match_hold_updated', {
        ...base,
        state: diff.state,
        candidate: diff.payload,
      });
      emitLegacyUpdate([toLegacyMatch(diff.payload)]);
      break;
    case SESSION_EVENT.LOCKED:
      socket.emit('audio_match_locked', {
        ...base,
        state: diff.state,
        candidate: diff.payload,
      });
      emitLegacyUpdate([toLegacyMatch(diff.payload)]);
      // Broadcast the lock to the whole event room so other clients
      // (DJ dashboard, attendee coverflow) can react.
      if (io) {
        toEventRoom(io, eventId).emit('audio_match_locked', {
          ...base,
          state: diff.state,
          candidate: diff.payload,
        });
      }
      break;
    case SESSION_EVENT.RELEASED:
      socket.emit('audio_match_released', {
        ...base,
        state: diff.state,
        reason: diff.payload?.reason || 'released',
        previousCandidate: diff.payload || null,
      });
      emitLegacyUpdate([]);
      if (io) {
        toEventRoom(io, eventId).emit('audio_match_released', {
          ...base,
          state: diff.state,
          reason: diff.payload?.reason || 'released',
          previousCandidate: diff.payload || null,
        });
      }
      break;
    case SESSION_EVENT.QUEUE_UPDATED:
      socket.emit('audio_match_queue_updated', {
        ...base,
        state: diff.state,
        trackId: diff.payload?.trackId,
        queueContext,
      });
      break;
    case SESSION_EVENT.IDLE:
      socket.emit('audio_match_idle', { ...base, reason: diff.payload?.reason });
      emitLegacyUpdate([]);
      break;
    default:
      // Unknown event — do not emit anything.
      break;
  }
}

async function emitMatchDiffAndActions(socket, io, eventId, diff) {
  emitMatchDiff(socket, io, eventId, diff);
  if (diff?.event !== SESSION_EVENT.LOCKED) return;
  await sendLockedUpNextNow(socket, io, eventId, diff.payload);
}

async function sendLockedUpNextNow(socket, io, eventId, candidate) {
  const trackId = candidate?.trackId;
  if (!trackId || !candidate.queueContext?.nextApproved) return;
  if (socket.audioMatch?.autoSentTrackId === trackId) return;

  try {
    socket.audioMatch.autoSentTrackId = trackId;
    const song = await audioTracksService.sendMatchedTrackNow(eventId, socket.user, trackId);
    const payload = {
      eventId,
      songId: song._id,
      title: song.title,
      artist: song.artist,
      recognitionMatch: song.recognitionMatch || null,
      trackId,
      status: song.status,
      totalDuration: song.totalDuration || 0,
      duration: song.duration || 0,
      albumArt: song.recognitionMatch?.coverUrl || null,
      playingStartedAt: song.playingStartedAt || song.startedPlayingAt,
      timestamp: new Date().toISOString(),
    };

    toEventRoom(io, eventId).emit('song_now_playing', payload);
    toEventRoom(io, eventId).emit('queue_updated', {
      eventId,
      ...(await songsService.getQueueSnapshotForEvent(eventId)),
      timestamp: new Date().toISOString(),
    });
    await matchSessionRegistry.applyQueueEventToEvent(eventId, {
      type: 'song_now_playing',
      songId: String(song._id),
      trackId,
      status: song.status,
      timestamp: new Date().toISOString(),
    });
    await matchSessionRegistry.applyQueueEventToEvent(eventId, {
      type: 'queue_updated',
      trackId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    socket.audioMatch.autoSentTrackId = '';
    logger.warn('Auto send matched up-next track failed', {
      eventId,
      trackId,
      message: error.message,
    });
    const resetDiffs = socket.audioMatch?.session?.reset?.() || [];
    for (const resetDiff of resetDiffs) emitMatchDiff(socket, io, eventId, resetDiff);
  }
}

function toLegacyMatch(candidate) {
  if (!candidate) return null;
  return {
    trackId: candidate.trackId,
    title: candidate.title,
    artist: candidate.artist,
    coverUrl: candidate.coverUrl,
    duration: candidate.duration,
    offset: candidate.offset || 0,
    score: candidate.score,
    totalAligned: candidate.totalAligned,
    offsetConcentration: candidate.offsetConcentration,
    queueContext: candidate.queueContext,
  };
}

const handleAudioMatchStart = async (socket, io, data, callback) => {
  try {
    const { eventId, sampleRate } = data || {};
    logger.info('Audio match start', { eventId, sampleRate: sampleRate ?? 'not provided' });
    const eventObjectId = await assertAudioEventAccess(socket, eventId);
    await sharedRamMatcher.loadEvent(eventObjectId);

    // Tear down any prior session cleanly (e.g. client retried the
    // start call). Releasing the prior hold lets listeners settle
    // before the new session emits its first candidate.
    if (socket.audioMatch?.unregister) socket.audioMatch.unregister();
    if (socket.audioMatch?.session) {
      socket.audioMatch.session.reset();
    }

    const session = new MatchSession({
      eventId: eventObjectId,
      ramMatcher: sharedRamMatcher,
      options: LIVE_MATCH_OPTIONS,
    });
    // Deliver queue/DJ driven transitions (release on track change, lock
    // confirmation) back to this socket so the phone can pause/resume its
    // stream even though those diffs originate outside the chunk loop.
    const unregister = matchSessionRegistry.register(eventObjectId, session, (diff) =>
      emitMatchDiff(socket, io, eventObjectId, diff),
    );

    socket.audioMatch = {
      eventId: eventObjectId,
      fingerprinter: new StreamingFingerprinter(TARGET_SAMPLE_RATE, { keepHashHistory: false }),
      ramMatcher: sharedRamMatcher,
      inputSampleRate: sampleRate,
      lastEmitAt: 0,
      session,
      unregister,
    };
    ackSuccess(callback, {
      eventId: eventObjectId,
      session: session.getState(),
    });
  } catch (error) {
    logger.error('Error starting audio matcher:', error);
    ackError(callback, error);
  }
};

const handleAudioMatchChunk = async (socket, io, data, callback) => {
  try {
    if (!socket.audioMatch) {
      if (socket._audioMatchLoading) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!socket.audioMatch) throw new Error('Audio matcher failed to start');
      } else {
        socket._audioMatchLoading = true;
        try {
          const { eventId, sampleRate } = data || {};
          if (socket.user?.type === 'phone-microphone' && eventId) {
            const eventObjectId = await assertAudioEventAccess(socket, eventId);
            logger.info('Auto-starting audio matcher for phone microphone', { eventId: eventObjectId, sampleRate });
            await sharedRamMatcher.loadEvent(eventObjectId);
            const session = new MatchSession({
              eventId: eventObjectId,
              ramMatcher: sharedRamMatcher,
              options: LIVE_MATCH_OPTIONS,
            });
            const unregister = matchSessionRegistry.register(eventObjectId, session, (diff) =>
              emitMatchDiff(socket, io, eventObjectId, diff),
            );
            socket.audioMatch = {
              eventId: eventObjectId,
              fingerprinter: new StreamingFingerprinter(TARGET_SAMPLE_RATE, { keepHashHistory: false }),
              ramMatcher: sharedRamMatcher,
              inputSampleRate: sampleRate,
              lastEmitAt: 0,
              session,
              unregister,
            };
          } else {
            throw new Error('Audio matcher has not started');
          }
        } finally {
          socket._audioMatchLoading = false;
        }
      }
    }

    const session = socket.audioMatch;
    const rawSamples = extractFloat32Pcm(data?.pcm ?? data);

    const chunkSampleRate = data?.sampleRate;
    const inputSampleRate = Number.isFinite(chunkSampleRate) && chunkSampleRate > 0
      ? chunkSampleRate
      : (session.inputSampleRate || TARGET_SAMPLE_RATE);

    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
      throw new Error(
        `Invalid audio chunk sampleRate: ${data?.sampleRate ?? session.inputSampleRate}`,
      );
    }
    const samples = inputSampleRate === TARGET_SAMPLE_RATE
      ? rawSamples
      : resampleLinear(rawSamples, inputSampleRate, TARGET_SAMPLE_RATE);

    const hashes = session.fingerprinter.process(samples) ?? [];
    const now = Date.now();
    const AUDIO_MATCH_INTERVAL_MS = 700;

    if (!session._lastDebugLogAt || now - session._lastDebugLogAt > 60000) {
      session._lastDebugLogAt = now;
      logger.info('Audio match debug', {
        eventId: session.eventId,
        inputSampleRate,
        targetSampleRate: TARGET_SAMPLE_RATE,
        rawSamplesLength: rawSamples.length,
        resampledSamplesLength: samples.length,
        hashesGenerated: hashes.length,
      });
    }

    // Waveform emit throttled to 400 ms (50 KB/s/phone vs 128 KB/s at 100 ms).
    const WAVEFORM_EMIT_INTERVAL_MS = 400;
    if (now - (session.lastWaveformAt || 0) > WAVEFORM_EMIT_INTERVAL_MS) {
      session.lastWaveformAt = now;
      socket.to(`event:${session.eventId}`).emit('phone_audio_stream', {
        eventId: session.eventId,
        pcm: Array.from(rawSamples),
        sampleRate: inputSampleRate,
        timestamp: Date.now(),
      });
    }

    // The match session is the single source of truth for what to emit
    // back to the client. We feed it the latest hashes and let it decide
    // whether the top candidate moved, the hold should start, the lock
    // is now safe, or we should release.
    if (hashes.length) {
      const matchSession = session.session;
      if (matchSession) {
        const diffs = await matchSession.addChunk(hashes);
        for (const diff of diffs) {
          await emitMatchDiffAndActions(socket, io, session.eventId, diff);
        }
        // Re-evaluate the lock condition on a debounce so a candidate
        // that has been held long enough promotes to "locked" even if
        // the next audio chunk is silent (DJ muted the room, etc.).
        if (
          matchSession.state === 'holding' &&
          matchSession.holdStartedAt > 0 &&
          now - (session.lastReEvalAt || 0) > matchSession.reMatchDebounceMs
        ) {
          session.lastReEvalAt = now;
          const reDiff = await matchSession.reEvaluate();
          for (const diff of reDiff) {
            await emitMatchDiffAndActions(socket, io, session.eventId, diff);
          }
        }
      } else {
        // Fallback for the brief window where the legacy path is still
        // in use (e.g. tests that bypass session creation). The path
        // mirrors the old behaviour but throttles the emit.
        if (now - session.lastEmitAt > AUDIO_MATCH_INTERVAL_MS) {
          session.lastEmitAt = now;
          const MAX_LIVE_MATCH_HASHES = 2000;
          const queryHashes = hashes.length > MAX_LIVE_MATCH_HASHES
            ? hashes.slice(-MAX_LIVE_MATCH_HASHES)
            : hashes;
          const matches = session.ramMatcher.match(session.eventId, queryHashes);
          const update = {
            eventId: session.eventId,
            matches,
            timestamp: new Date().toISOString(),
          };
          socket.emit('audio_match_update', update);
          socket.to(`event:${session.eventId}`).emit('audio_match_update', update);
        }
      }
    }

    ackSuccess(callback, {
      hashes: hashes.length,
      inputSamples: rawSamples.length,
      normalizedSamples: samples.length,
      inputSampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
    });
  } catch (error) {
    logger.error('Error matching audio chunk:', {
      message: error.message,
      dataType: data?.constructor?.name,
      pcmType: data?.pcm?.constructor?.name,
    });
    ackError(callback, error);
  }
};

const handleAudioMatchStop = async (socket, io, data, callback) => {
  try {
    logger.info('Audio match stop requested', { hadAudioMatch: Boolean(socket.audioMatch) });
    if (socket.audioMatch) {
      const { eventId, fingerprinter, ramMatcher, session: matchSession, unregister } = socket.audioMatch;
      if (matchSession) {
        // Final pass: flush any pending hashes from the fingerprinter
        // so the session sees the last few seconds of audio. The
        // session will return a release diff if it was holding.
        const tailHashes = fingerprinter.flush();
        if (tailHashes.length) {
          const diffs = await matchSession.addChunk(tailHashes);
          for (const diff of diffs) {
            await emitMatchDiffAndActions(socket, io, eventId, diff);
          }
        }
        // Reset the session so any subscribed listeners see the
        // explicit "released" state and the per-event registry drops
        // the reference.
        const resetDiffs = matchSession.reset();
        for (const diff of resetDiffs) {
          emitMatchDiff(socket, io, eventId, diff);
        }
        if (typeof unregister === 'function') unregister();
      } else {
        // Legacy path
        const hashes = fingerprinter.flush();
        const matches = ramMatcher.match(eventId, hashes);
        const update = {
          eventId,
          matches,
          timestamp: new Date().toISOString(),
        };
        socket.emit('audio_match_update', update);
        socket.to(`event:${eventId}`).emit('audio_match_update', update);
      }
    }
    socket.audioMatch = null;
    ackSuccess(callback, { stopped: true });
  } catch (error) {
    logger.error('Error stopping audio matcher:', error);
    ackError(callback, error);
  }
};

module.exports = {
  handleAudioMatchStart,
  handleAudioMatchChunk,
  handleAudioMatchStop,
  assertAudioEventAccess,
  extractFloat32Pcm,
  emitMatchDiff,
};
