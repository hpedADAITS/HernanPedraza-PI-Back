// RAM-based matcher for live audio recognition.
// Loads fingerprints from MongoDB once per event, then performs in-memory lookups.

const { AudioFingerprintModel, AudioTrackModel } = require('../../models/schema');
const { logger } = require('../../utils');

const MAX_MATCH_HASHES = 1200;
const MIN_ALIGNED_HASHES = 4;
const MIN_BEST_SCORE_GAP = 2;

// In-memory fingerprint storage keyed by eventId
// Format: Map<eventId, { tracks: Map<trackId, TrackInfo>, index: Map<hash, Array<{trackId, sourceTime}>> }>
const eventIndex = new Map();

class RamMatcher {
  constructor() {
    this.loadPromises = new Map();
  }

  async loadEvent(eventId) {
    if (eventIndex.has(eventId)) {
      return eventIndex.get(eventId);
    }

    // Prevent duplicate concurrent loads for the same event
    if (this.loadPromises.has(eventId)) {
      return this.loadPromises.get(eventId);
    }

    const loadPromise = this._doLoad(eventId);
    this.loadPromises.set(eventId, loadPromise);

    try {
      const result = await loadPromise;
      eventIndex.set(eventId, result);
      return result;
    } finally {
      this.loadPromises.delete(eventId);
    }
  }

  async _doLoad(eventId) {
    const fingerprints = await AudioFingerprintModel.find({ eventId })
      .select('trackId hashesCount hashes')
      .lean();

    if (!fingerprints.length) {
      logger.info('RAM matcher loaded event - no fingerprints', { eventId });
      return { tracks: new Map(), index: new Map() };
    }

    // Build track info map
    const trackIds = fingerprints.map((fp) => fp.trackId);
    const tracks = await AudioTrackModel.find({ _id: { $in: trackIds } })
      .select('title artist coverUrl duration sampleRate')
      .lean();
    const trackInfoById = new Map(tracks.map((t) => [t._id.toString(), t]));

    // Build in-memory hash index
    const index = new Map();
    let totalHashes = 0;

    for (const fp of fingerprints) {
      const trackId = fp.trackId.toString();
      const hashes = fp.hashes || [];
      totalHashes += hashes.length;

      for (const { h, t } of hashes) {
        const key = Number(h);
        if (!Number.isFinite(key)) continue;

        let entries = index.get(key);
        if (!entries) {
          index.set(key, (entries = []));
        }
        entries.push({ trackId, sourceTime: Number(t) });
      }
    }

    logger.info('RAM matcher loaded event fingerprints', {
      eventId,
      fingerprintCount: fingerprints.length,
      totalHashes,
      indexSize: index.size,
      trackCount: tracks.length,
    });

    // Convert arrays to reduce memory overhead
    // (already done in array form for simplicity)

    return { tracks: trackInfoById, index };
  }

  match(eventId, hashes) {
    const cached = eventIndex.get(eventId);
    if (!cached || !cached.index.size) {
      return [];
    }

    const { index, tracks } = cached;
    const buckets = new Map();

    for (const { hash, time } of hashes) {
      const key = Number(hash);
      const sampleTime = Number(time);
      if (!Number.isFinite(key) || !Number.isFinite(sampleTime)) continue;

      const candidates = index.get(key);
      if (!candidates) continue;

      for (const { trackId, sourceTime } of candidates) {
        const offset = sourceTime - sampleTime;
        const bucketKey = `${trackId}:${offset}`;
        buckets.set(bucketKey, (buckets.get(bucketKey) || 0) + 1);
      }
    }

    const bestByTrack = new Map();
    for (const [key, score] of buckets) {
      const split = key.lastIndexOf(':');
      const trackId = key.slice(0, split);
      const offset = Number(key.slice(split + 1));
      const current = bestByTrack.get(trackId);
      if (!current || score > current.score) {
        bestByTrack.set(trackId, { trackId, offset, score });
      }
    }

    const sorted = [...bestByTrack.values()].sort((a, b) => b.score - a.score);
    const scored = sorted
      .filter((match, index) => isConfidentMatch(match, index, sorted.length))
      .slice(0, 5);

    return scored.map((match) => {
      const track = tracks.get(match.trackId);
      return {
        trackId: match.trackId,
        offset: match.offset,
        score: match.score,
        title: track?.title || 'Unknown track',
        artist: track?.artist || 'Unknown artist',
        coverUrl: track?.coverUrl || null,
        duration: track?.duration || 0,
        sampleRate: track?.sampleRate || 0,
      };
    });
  }

  // Clear in-memory index for an event (call when matching ends)
  clearEvent(eventId) {
    eventIndex.delete(eventId);
  }

  // Get current stats for monitoring
  getStats(eventId) {
    const cached = eventIndex.get(eventId);
    if (!cached) {
      return null;
    }
    return {
      tracksLoaded: cached.tracks.size,
      hashesIndexed: cached.index.size,
    };
  }
}

function normalizeHashRows(hashes) {
  const seen = new Set();
  const rows = [];

  for (const item of hashes || []) {
    const hash = Number(item.hash);
    const time = Number(item.time);
    if (!Number.isFinite(hash) || !Number.isFinite(time) || seen.has(hash)) continue;
    seen.add(hash);
    rows.push({ hash, time });
    if (rows.length >= MAX_MATCH_HASHES) break;
  }

  return rows;
}

// Wrapper function for backward compatibility
async function matchHashes(eventId, hashes) {
  const rows = normalizeHashRows(hashes);
  if (!rows.length) return [];

  const matcher = new RamMatcher();
  await matcher.loadEvent(eventId);
  return matcher.match(eventId, rows);
}

function isConfidentMatch(match, index, matchCount) {
  if (match.score < MIN_ALIGNED_HASHES) return false;
  if (index === 0 && matchCount > 1 && match.score - matchCount < MIN_BEST_SCORE_GAP) return false;
  return true;
}

module.exports = { RamMatcher, matchHashes, normalizeHashRows };