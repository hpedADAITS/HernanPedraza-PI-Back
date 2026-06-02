const { AudioFingerprintHashModel, AudioTrackModel } = require('../../models/schema');

const MAX_MATCH_HASHES = 1200;

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

async function matchHashes(eventId, hashes, limit = 5) {
  const rows = normalizeHashRows(hashes);
  if (!rows.length) return [];

  const timeByHash = new Map(rows.map(({ hash, time }) => [hash, time]));
  const sourceRows = await AudioFingerprintHashModel.find({
    eventId,
    hash: { $in: rows.map(({ hash }) => hash) },
  })
    .select('hash trackId sourceTime')
    .lean();

  const buckets = new Map();
  for (const row of sourceRows) {
    const sampleTime = timeByHash.get(row.hash);
    if (sampleTime === undefined) continue;
    const trackId = row.trackId.toString();
    const offset = row.sourceTime - sampleTime;
    const key = `${trackId}:${offset}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const bestByTrack = new Map();
  for (const [key, score] of buckets) {
    const split = key.lastIndexOf(':');
    const trackId = key.slice(0, split);
    const offset = Number(key.slice(split + 1));
    const current = bestByTrack.get(trackId);
    if (!current || score > current.score) bestByTrack.set(trackId, { trackId, offset, score });
  }

  const scored = [...bestByTrack.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!scored.length) return [];

  const tracks = await AudioTrackModel.find({
    _id: { $in: scored.map(({ trackId }) => trackId) },
  })
    .select('title artist duration sampleRate')
    .lean();
  const trackById = new Map(tracks.map((track) => [track._id.toString(), track]));

  return scored.map((match) => {
    const track = trackById.get(match.trackId);
    return {
      ...match,
      title: track?.title || 'Unknown track',
      artist: track?.artist || 'Unknown artist',
      duration: track?.duration || 0,
      sampleRate: track?.sampleRate || 0,
    };
  });
}

module.exports = { matchHashes };
