// RAM-based matcher for live audio recognition.
// Loads fingerprints from MongoDB once per event, then performs in-memory lookups.
//
// Resource budgets (512 MB Render deployment):
//   MongoDB document: 16 MB hard limit per document.
//   Per-track hashes:   3-7 min of audio -> ~30-100k hashes -> ~240-800 KB packed.
//   Per-event hashes:   cap at 200k -> ~1.6 MB packed, well under the 16 MB limit.
//   In-memory index:    ~50 bytes per (hash → {trackId, sourceTime}) entry.
//                       200k entries ≈ 10 MB. MAX_CACHED_EVENTS=2 → ~20 MB.
//   Available heap:     ~260 MB after Node + Mongoose + app. Audio is a small share.

const { AudioFingerprintModel, AudioTrackModel } = require('../../models/schema');
const { logger } = require('../../utils');
const { decryptCoverUrl } = require('../cover-url-crypto');
const { storedHashRows } = require('./fingerprint-codec');

const MIN_MATCH_SCORE = 4;

// Caps below keep AudioFingerprintModel.hashData under MongoDB's 16 MB document
// limit and keep the in-memory index bounded per the budget above. Legacy
// AudioFingerprintModel.hashes arrays are still decoded on load.
const MAX_TRACK_HASHES = 100_000;
const MAX_INDEXED_HASHES_PER_EVENT = 200_000;

// In-memory fingerprint storage keyed by eventId
// Format: Map<eventId, { tracks: Map<trackId, TrackInfo>, trackIds: string[], index: Map<hash, Array<[trackIndex, sourceTime]>> }>
const eventIndex = new Map();

// Maximum events to keep in memory. At MAX_INDEXED_HASHES_PER_EVENT each,
// this caps the matcher cache at ~20 MB. Realistic for a 512 MB deployment.
const MAX_CACHED_EVENTS = 2;

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

    // Evict LRU event if at capacity
    if (eventIndex.size >= MAX_CACHED_EVENTS) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, val] of eventIndex) {
        if (val._loadedAt < oldestTime) {
          oldestTime = val._loadedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        eventIndex.delete(oldestKey);
        logger.info('RAM matcher evicted event from cache', { eventId: oldestKey });
      }
    }

    const loadPromise = this._doLoad(eventId);
    this.loadPromises.set(eventId, loadPromise);

    try {
      const result = await loadPromise;
      result._loadedAt = Date.now();
      eventIndex.set(eventId, result);
      return result;
    } finally {
      this.loadPromises.delete(eventId);
    }
  }

  async _doLoad(eventId) {
    const fingerprints = await AudioFingerprintModel.find({ eventId })
      .select('trackId hashesCount hashData hashes')
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
    const trackIdsByIndex = [];
    let totalHashes = 0;
    let indexedHashes = 0;
    let truncated = false;

    for (const fp of fingerprints) {
      const trackId = fp.trackId.toString();
      const hashes = storedHashRows(fp);

      // Skip tracks with too many hashes to prevent OOM
      if (hashes.length > MAX_TRACK_HASHES) {
        logger.warn('RAM matcher skipping track with excessive hashes', {
          trackId,
          hashesCount: hashes.length,
        });
        continue;
      }

      totalHashes += hashes.length;
      const remaining = MAX_INDEXED_HASHES_PER_EVENT - indexedHashes;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }

      const trackIndex = trackIdsByIndex.length;
      trackIdsByIndex.push(trackId);
      const rows = hashes.length > remaining ? hashes.slice(0, remaining) : hashes;
      if (rows.length < hashes.length) truncated = true;

      for (const { h, t } of rows) {
        const key = Number(h);
        if (!Number.isFinite(key)) continue;

        let entries = index.get(key);
        if (!entries) {
          index.set(key, (entries = []));
        }
        entries.push([trackIndex, Number(t)]);
      }
      indexedHashes += rows.length;
    }

    if (truncated) {
      logger.warn('RAM matcher event exceeds safe hash limit, truncating index', {
        eventId,
        totalHashes,
        indexedHashes,
        limit: MAX_INDEXED_HASHES_PER_EVENT,
      });
    }

    logger.info('RAM matcher loaded event fingerprints', {
      eventId,
      fingerprintCount: fingerprints.length,
      totalHashes,
      indexedHashes,
      indexSize: index.size,
      estimatedMemoryMB: Math.round((indexedHashes * 32) / (1024 * 1024)),
      trackCount: tracks.length,
    });

    // Convert arrays to reduce memory overhead
    // (already done in array form for simplicity)

    return { tracks: trackInfoById, trackIds: trackIdsByIndex, index };
  }

  match(eventId, hashes) {
    const cached = eventIndex.get(eventId);
    if (!cached || !cached.index.size) {
      return [];
    }

    const { index, tracks, trackIds } = cached;
    const buckets = new Map();

    for (const { hash, time } of hashes) {
      const key = Number(hash);
      const sampleTime = Number(time);
      if (!Number.isFinite(key) || !Number.isFinite(sampleTime)) continue;

      const candidates = index.get(key);
      if (!candidates) continue;

      for (const [trackIndex, sourceTime] of candidates) {
        const trackId = trackIds[trackIndex];
        if (!trackId) continue;
        const offset = sourceTime - sampleTime;
        let byOffset = buckets.get(trackId);
        if (!byOffset) {
          byOffset = new Map();
          buckets.set(trackId, byOffset);
        }
        byOffset.set(offset, (byOffset.get(offset) || 0) + 1);
      }
    }

    const scored = [];
    for (const [trackId, byOffset] of buckets) {
      let bestOffset = 0;
      let bestScore = 0;
      for (const [offset, count] of byOffset) {
        if (count > bestScore) {
          bestScore = count;
          bestOffset = offset;
        }
      }
      if (bestScore < MIN_MATCH_SCORE) continue;
      scored.push({ trackId, offset: bestOffset, score: bestScore });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, 5).map((match) => {
      const track = tracks.get(match.trackId);
      return {
        trackId: match.trackId,
        offset: match.offset,
        score: match.score,
        title: track?.title || 'Unknown track',
        artist: track?.artist || 'Unknown artist',
        coverUrl: decryptCoverUrl(track?.coverUrl),
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
    if (!Number.isFinite(hash) || !Number.isFinite(time)) continue;
    const key = `${hash}:${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ hash, time });
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

module.exports = { RamMatcher, matchHashes, normalizeHashRows };
