const { logger } = require('../utils');

const BASE_URL = 'https://musicbrainz.org/ws/2';
const COVER_ART_BASE_URL = 'https://coverartarchive.org';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const COVER_ART_TIMEOUT_MS = 3000;
const COVER_ART_REQUEST_INTERVAL_MS = 800;
const MAX_CACHE_SIZE = 250;
const MIN_SCORE = 0.72;
const MIN_CANDIDATE_SCORE = 0.35;
const MAX_REQUESTS_PER_SECOND = 1;
const MIN_REQUEST_INTERVAL_MS = 1550;
const FAILURE_BACKOFF_MS = 60 * 1000;
const MAX_TRANSPORT_ATTEMPTS = 2;
const RECORDING_SEARCH_LIMIT = '4';
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
    this.unavailableUntil = 0;
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
    const matches = await this.findRecordingMatches(title, artist, totalDuration);
    const match = matches[0] || null;
    if (!match?.releaseId) return match;

    const coverUrl = await this._fetchCoverArt(match.releaseId);
    return coverUrl ? { ...match, coverUrl } : match;
  }

  async findRecordingMatches(title, artist, totalDuration) {
    const targetTitle = normalizeText(title);
    const targetArtist = normalizeText(artist);
    if (!targetTitle || !targetArtist || typeof fetch !== 'function') return [];
    if (shouldSkipLookup(title) || shouldSkipLookup(artist)) {
      logger.info('MusicBrainz lookup skipped for placeholder metadata', { title, artist });
      return [];
    }

    const cacheKey = `matches:${targetTitle}|${targetArtist}|${Math.round(Number(totalDuration) || 0)}`;
    const cached = this._getCached(cacheKey);
    if (cached !== undefined) {
      logger.info('MusicBrainz cache hit', { title, artist, results: cached.map(summarizeMatch) });
      return cached;
    }
    if (this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);

    const lookup = this._lookupRecordingMatches(cacheKey, title, artist, targetTitle, targetArtist, totalDuration);
    this.inFlight.set(cacheKey, lookup);
    return lookup;
  }

  async _lookupRecordingMatches(cacheKey, title, artist, targetTitle, targetArtist, totalDuration) {
    try {
      logger.info('MusicBrainz lookup started', { title, artist, totalDuration });
      const data = await this._getJson('/recording', {
        query: buildRecordingSearchQuery(title, artist),
        limit: RECORDING_SEARCH_LIMIT,
        offset: '0',
        fmt: 'json',
      });
      const recordings = data?.recordings || [];
      const matches = this._recordingCandidates(recordings, targetTitle, targetArtist, totalDuration);
      logger.info('MusicBrainz lookup returned candidates', {
        title,
        artist,
        count: recordings.length,
        candidates: recordings.map(summarizeRecording),
      });
      if (!matches.length) {
        logger.info('MusicBrainz lookup found no acceptable match', { title, artist });
        this._setCached(cacheKey, []);
        return [];
      }
      logger.info('MusicBrainz lookup selected matches', { title, artist, results: matches.map(summarizeMatch) });
      this._setCached(cacheKey, matches);
      return matches;
    } catch (error) {
      logger.warn('MusicBrainz lookup failed', {
        message: error.message,
        cause: error.cause ? error.cause.code || error.cause.message || String(error.cause) : null,
      });
      this._setCached(cacheKey, []);
      return [];
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  async _getJson(path, params) {
    const run = this.requestTail.then(async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
        try {
          return await this._attemptFetchJson(path, params, attempt);
        } catch (error) {
          lastError = error;
          if (!isRetryableTransportError(error) || attempt === MAX_TRANSPORT_ATTEMPTS) {
            if (isBackoffError(error)) this.unavailableUntil = Date.now() + FAILURE_BACKOFF_MS;
            throw error;
          }
          logger.warn('MusicBrainz transport error; retrying once', {
            path,
            attempt,
            message: error.message,
            cause: error.cause ? error.cause.code || error.cause.message || String(error.cause) : null,
          });
        }
      }
      throw lastError;
    });

    this.requestTail = run.catch(() => {});
    return run;
  }

  async _attemptFetchJson(path, params, attempt) {
    if (Date.now() < this.unavailableUntil) throw new Error('MusicBrainz backoff active');

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
        attempt,
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
      if (!response.ok) {
        const error = new Error(`MusicBrainz ${response.status}`);
        error.status = response.status;
        throw error;
      }
      logger.info('MusicBrainz API response OK', { path, attempt, status: response.status });
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
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

  _recordingCandidates(recordings, targetTitle, targetArtist, totalDuration) {
    return recordings
      .map((recording) => this._formatRecordingCandidate(recording, targetTitle, targetArtist, totalDuration))
      .filter((recording) => recording && recording.score >= MIN_CANDIDATE_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(RECORDING_SEARCH_LIMIT));
  }

  _formatRecordingCandidate(recording, targetTitle, targetArtist, totalDuration) {
    const artist = readArtistCredit(recording['artist-credit']);
    const titleScore = similarity(targetTitle, normalizeText(recording.title));
    const artistScore = similarity(targetArtist, normalizeText(artist));
    const durationScore = durationSimilarity(totalDuration, recording.length);
    const mbScore = Math.min(Number(recording.score) || 0, 100) / 100;
    const score = (titleScore * 0.45) + (artistScore * 0.35) + (mbScore * 0.15) + (durationScore * 0.05);

    if (score < MIN_SCORE && mbScore < 0.9) return null;
    return {
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

function buildRecordingSearchQuery(title, artist) {
  return `recording:(${escapeSearchTerm(title)}) AND artist:(${escapeSearchTerm(artist)})`;
}

function escapeSearchTerm(value) {
  return String(value || '')
    .replace(/[()[\]{}^~*?:\\/+\-!|&"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldSkipLookup(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized.includes('PLACEHOLDER') || normalized.includes('BADLY_WRITTEN');
}

function isBackoffError(error) {
  return error?.name === 'AbortError'
    || error?.message === 'fetch failed'
    || error?.message === 'MusicBrainz backoff active'
    || error?.status === 429
    || error?.status >= 500;
}

function isRetryableTransportError(error) {
  return error?.message === 'fetch failed'
    || error?.cause?.code === 'ECONNRESET'
    || error?.cause?.code === 'ETIMEDOUT'
    || error?.cause?.code === 'UND_ERR_SOCKET';
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
