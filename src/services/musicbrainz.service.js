const { logger } = require('../utils');

const BASE_URL = 'https://musicbrainz.org/ws/2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;
const MAX_CACHE_SIZE = 250;
const MIN_SCORE = 0.72;
const MIN_REQUEST_INTERVAL_MS = 1500;
const USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT ||
  'SyncRekuest/1.0 (github.com/hpedadaits/hernanpedraza-pi-back)';

class MusicBrainzService {
  constructor() {
    this.cache = new Map();
    this.inFlight = new Map();
    this.lastRequestAt = 0;
    this.requestTail = Promise.resolve();
  }

  async findRecordingMatch(title, artist, totalDuration) {
    const targetTitle = normalizeText(title);
    const targetArtist = normalizeText(artist);
    if (!targetTitle || !targetArtist || typeof fetch !== 'function') return null;

    const cacheKey = `${targetTitle}|${targetArtist}|${Math.round(Number(totalDuration) || 0)}`;
    const cached = this._getCached(cacheKey);
    if (cached !== undefined) return cached;
    if (this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);

    const lookup = this._lookupRecordingMatch(cacheKey, title, artist, targetTitle, targetArtist, totalDuration);
    this.inFlight.set(cacheKey, lookup);
    return lookup;
  }

  async _lookupRecordingMatch(cacheKey, title, artist, targetTitle, targetArtist, totalDuration) {
    try {
      const data = await this._getJson('/recording', {
        query: `recording:"${escapeQuery(title)}" AND artist:"${escapeQuery(artist)}"`,
        limit: '5',
        offset: '0',
        fmt: 'json',
      });
      const match = this._bestRecording(data?.recordings || [], targetTitle, targetArtist, totalDuration);
      this._setCached(cacheKey, match);
      return match;
    } catch (error) {
      logger.warn('MusicBrainz lookup failed', { message: error.message });
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
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
        return response.json();
      } finally {
        clearTimeout(timeout);
      }
    });

    this.requestTail = run.catch(() => {});
    return run;
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

module.exports = new MusicBrainzService();
