const { logger } = require('../utils');

const BASE_URL = 'https://musicbrainz.org/ws/2';
const COVER_ART_BASE_URL = 'https://coverartarchive.org';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;
const COVER_ART_TIMEOUT_MS = 3000;
const COVER_ART_REQUEST_INTERVAL_MS = 800;
const MAX_CACHE_SIZE = 250;
const MIN_SCORE = 0.72;
const MAX_REQUESTS_PER_SECOND = 1.5;
const MIN_REQUEST_INTERVAL_MS = 1500;
const USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT ||
  'Syncrequest Student Project (github.com/hpedadaits/hernanpedraza-pi-back)';

class MusicBrainzService {
  constructor() {
    this.cache = new Map();
    this.inFlight = new Map();
    this.lastRequestAt = 0;
    this.lastCoverArtAt = 0;
    this.requestTail = Promise.resolve();
  }

  async lookupRecordingSummary(recordingId) {
    if (!recordingId) return null;
    const cacheKey = `recording:${recordingId}`;
    const cached = this._getCached(cacheKey);
    if (cached !== undefined) return cached;
    if (this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);
    const lookup = this._lookupRecordingSummary(cacheKey, recordingId);
    this.inFlight.set(cacheKey, lookup);
    return lookup;
  }

  async _lookupRecordingSummary(cacheKey, recordingId) {
    try {
      const data = await this._getJson(`/recording/${encodeURIComponent(recordingId)}`, { fmt: 'json' });
      if (!data) return this._cacheAndReturn(cacheKey, null);
      const summary = {
        title: data.title || null,
        artist: readArtistCredit(data['artist-credit']),
        coverUrl: null,
        metadataSha512: null,
      };
      if (data.releases?.length) {
        const releaseId = data.releases[0].id;
        if (releaseId) {
          summary.coverUrl = await this._fetchCoverArt(releaseId);
        }
      }
      return this._cacheAndReturn(cacheKey, summary);
    } catch (error) {
      logger.debug('lookupRecordingSummary failed', { recordingId, message: error.message });
      return this._cacheAndReturn(cacheKey, null);
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  _cacheAndReturn(key, value) {
    this._setCached(key, value);
    return value;
  }

  async findRecordingMatch(title, artist, totalDuration) {
    const targetTitle = normalizeText(title);
    const targetArtist = normalizeText(artist);
    if (!targetTitle || !targetArtist || typeof fetch !== 'function') return null;

    const cacheKey = `${targetTitle}|${targetArtist}|${Math.round(Number(totalDuration) || 0)}`;
    const cached = this._getCached(cacheKey);
    if (cached !== undefined) {
      logger.info('MusicBrainz cache hit', { title, artist, result: summarizeMatch(cached) });
      return cached;
    }
    if (this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);

    const lookup = this._lookupRecordingMatch(cacheKey, title, artist, targetTitle, targetArtist, totalDuration);
    this.inFlight.set(cacheKey, lookup);
    return lookup;
  }

  async _lookupRecordingMatch(cacheKey, title, artist, targetTitle, targetArtist, totalDuration) {
    try {
      logger.info('MusicBrainz lookup started', { title, artist, totalDuration });
      const data = await this._getJson('/recording', {
        query: `recording:"${escapeQuery(title)}" AND artist:"${escapeQuery(artist)}"`,
        limit: '5',
        offset: '0',
        fmt: 'json',
      });
      const recordings = data?.recordings || [];
      logger.info('MusicBrainz lookup returned candidates', {
        title,
        artist,
        count: recordings.length,
        candidates: recordings.map(summarizeRecording),
      });
      const recording = this._bestRecording(recordings, targetTitle, targetArtist, totalDuration);
      if (!recording) {
        logger.info('MusicBrainz lookup found no acceptable match', { title, artist });
        this._setCached(cacheKey, null);
        return null;
      }
      const releaseId = recording.releaseId;
      if (releaseId) {
        const coverUrl = await this._fetchCoverArt(releaseId);
        if (coverUrl) {
          recording.coverUrl = coverUrl;
        }
      }
      logger.info('MusicBrainz lookup selected match', { title, artist, result: summarizeMatch(recording) });
      this._setCached(cacheKey, recording);
      return recording;
    } catch (error) {
      logger.warn('MusicBrainz lookup failed', {
        message: error.message,
        cause: error.cause ? error.cause.code || error.cause.message || String(error.cause) : null,
      });
      this._setCached(cacheKey, null);
      return null;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  async _getJson(path, params) {
    const run = this.requestTail.then(async () => {
      const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs) await sleep(waitMs);
      this.lastRequestAt = Date.now();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const url = new URL(`${BASE_URL}${path}`);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        logger.info('MusicBrainz API request', {
          path,
          maxRequestsPerSecond: MAX_REQUESTS_PER_SECOND,
          minIntervalMs: MIN_REQUEST_INTERVAL_MS,
        });
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
        logger.info('MusicBrainz API response OK', { path, status: response.status });
        return response.json();
      } finally {
        clearTimeout(timeout);
      }
    });

    this.requestTail = run.catch(() => {});
    return run;
  }

  async _fetchCoverArt(releaseId) {
    try {
      const waitMs = Math.max(0, COVER_ART_REQUEST_INTERVAL_MS - (Date.now() - this.lastCoverArtAt));
      if (waitMs) await sleep(waitMs);
      this.lastCoverArtAt = Date.now();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), COVER_ART_TIMEOUT_MS);
      try {
        const response = await fetch(`${COVER_ART_BASE_URL}/release/${encodeURIComponent(releaseId)}`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const data = await response.json();
        const front = pickFrontImage(data?.images);
        if (!front) return null;
        /* Prefer a high-res derivative (~1200px). If absent, fall back to the
           original URL — Cover Art Archive will serve it at native size. */
        return pickHiresUrl(front) || front.image || null;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      logger.debug('Cover Art Archive fetch failed', { message: error.message });
      return null;
    }
  }

  _bestRecording(recordings, targetTitle, targetArtist, totalDuration) {
    let best = null;
    for (const recording of recordings) {
      const artist = readArtistCredit(recording['artist-credit']);
      const titleScore = similarity(targetTitle, normalizeText(recording.title));
      const artistScore = similarity(targetArtist, normalizeText(artist));
      const durationScore = durationSimilarity(totalDuration, recording.length);
      const mbScore = Math.min(Number(recording.score) || 0, 100) / 100;
      const score = (titleScore * 0.45) + (artistScore * 0.35) + (mbScore * 0.15) + (durationScore * 0.05);

      if (score < MIN_SCORE || (best && score <= best.score)) continue;
      best = {
        source: 'musicbrainz',
        recordingId: recording.id || null,
        releaseId: readFirstReleaseId(recording),
        title: recording.title,
        artist,
        coverUrl: null,
        duration: Number.isFinite(Number(recording.length)) && Number(recording.length) > 0
          ? Math.round(Number(recording.length) / 1000)
          : null,
        score: Number(score.toFixed(3)),
        matchedOn: titleScore >= 0.86 && artistScore >= 0.72 ? 'title_artist' : 'title',
      };
    }
    return best;
  }

  _getCached(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() - item.createdAt > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return item.value;
  }

  _setCached(key, value) {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { value, createdAt: Date.now() });
  }
}

function escapeQuery(value) {
  return String(value || '').replace(/["\\]/g, ' ');
}

function readArtistCredit(credits) {
  return Array.isArray(credits)
    ? credits.map((credit) => credit?.artist?.name || credit?.name).filter(Boolean).join(' ')
    : '';
}

function durationSimilarity(expectedSeconds, musicBrainzMs) {
  const expected = Number(expectedSeconds);
  const actual = Number(musicBrainzMs) / 1000;
  if (!expected || !actual) return 0.5;
  return Math.max(0, 1 - Math.abs(expected - actual) / Math.max(expected, actual));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap ? (2 * overlap) / (aTokens.size + bTokens.size) : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readFirstReleaseId(recording) {
  const firstRelease = Array.isArray(recording?.releases) ? recording.releases[0] : null;
  return firstRelease?.id || null;
}

function pickFrontImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  /* Cover Art Archive's `front: true` is the canonical front cover. If no
     image is flagged as front, fall back to the first image in the array. */
  const flagged = images.find((img) => img && img.front);
  return flagged || images[0] || null;
}

function pickHiresUrl(image) {
  if (!image?.thumbnails) return null;
  /* Try largest first, then walk down. CAA sizes are small, large, 250, 500,
     1200 (when available). We want ~1200 for sharp 3D cube textures. */
  const order = ['1200', 'large', '500', '250', 'small'];
  for (const size of order) {
    const candidate = image.thumbnails[size];
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return null;
}

function summarizeRecording(recording) {
  return {
    id: recording?.id || null,
    title: recording?.title || null,
    artist: readArtistCredit(recording?.['artist-credit']) || null,
    score: Number(recording?.score) || 0,
    duration: Number.isFinite(Number(recording?.length))
      ? Math.round(Number(recording.length) / 1000)
      : null,
    releaseId: readFirstReleaseId(recording),
  };
}

function summarizeMatch(match) {
  if (!match) return null;
  return {
    source: match.source || 'musicbrainz',
    title: match.title,
    artist: match.artist,
    score: match.score,
    duration: match.duration,
    recordingId: match.recordingId || null,
    releaseId: match.releaseId || null,
    hasCover: Boolean(match.coverUrl),
  };
}

module.exports = new MusicBrainzService();
