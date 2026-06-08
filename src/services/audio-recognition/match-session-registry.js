// Per-event registry of active MatchSession instances.
//
// MatchSession lives on a socket (the phone microphone and any other
// client that opens an audio match stream). When the DJ explicitly sends
// a track now (sendMatchedTrackNow), we need every live match session
// in that event to react — release its hold if the DJ chose a different
// track, or lock the hold if the DJ confirmed the candidate.
//
// This registry keeps that wiring out of the audio-tracks service. The
// service calls `applyDjIntentToEvent(eventId, trackId)` and forgets
// about sockets.

// Map<eventId, Set<{ session, onDiff }>>. Each entry pairs a MatchSession
// with an optional `onDiff(diff)` emitter so queue/DJ driven transitions
// (which originate outside the owning socket's chunk loop) can still be
// delivered back to that socket's client. Without this, a release caused
// by the DJ advancing the queue would mutate the session silently and the
// phone would never learn its match was dropped.
const sessionsByEvent = new Map();

function register(eventId, session, onDiff) {
  if (!eventId || !session) return () => {};
  const key = String(eventId);
  let bucket = sessionsByEvent.get(key);
  if (!bucket) {
    bucket = new Set();
    sessionsByEvent.set(key, bucket);
  }
  const entry = { session, onDiff: typeof onDiff === 'function' ? onDiff : null };
  bucket.add(entry);
  return () => {
    bucket?.delete(entry);
    if (bucket && bucket.size === 0) sessionsByEvent.delete(key);
  };
}

function entries(eventId) {
  if (!eventId) return [];
  return Array.from(sessionsByEvent.get(String(eventId)) || []);
}

function list(eventId) {
  return entries(eventId).map((entry) => entry.session);
}

function emitDiffs(entry, diffs) {
  if (!entry.onDiff || !Array.isArray(diffs) || !diffs.length) return;
  for (const diff of diffs) {
    try {
      entry.onDiff(diff);
    } catch (err) {
      require('../../utils').logger.warn('MatchSession diff emit failed', {
        message: err.message,
      });
    }
  }
}

async function applyDjIntentToEvent(eventId, trackId) {
  const bucket = entries(eventId);
  if (!bucket.length) return [];
  const all = [];
  for (const entry of bucket) {
    const diffs = entry.session.applyDjIntent(trackId) || [];
    emitDiffs(entry, diffs);
    all.push(diffs);
  }
  return all;
}

async function applyQueueEventToEvent(eventId, event) {
  const bucket = entries(eventId);
  if (!bucket.length) return [];
  const settled = await Promise.all(
    bucket.map(async (entry) => {
      try {
        const diffs = await entry.session.applyQueueEvent(event);
        emitDiffs(entry, diffs);
        return diffs;
      } catch (err) {
        // A failed enrichment must not break the broadcast for everyone
        // else; log and move on.
        require('../../utils').logger.warn('MatchSession applyQueueEvent failed', {
          message: err.message,
          eventId,
        });
        return [];
      }
    }),
  );
  return settled.flat();
}

function clear(eventId) {
  if (!eventId) return;
  sessionsByEvent.delete(String(eventId));
}

module.exports = {
  register,
  list,
  applyDjIntentToEvent,
  applyQueueEventToEvent,
  clear,
};
