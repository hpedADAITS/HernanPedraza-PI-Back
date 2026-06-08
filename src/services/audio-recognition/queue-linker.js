// Queue context lookup for fingerprinted track matches.
//
// When the streaming audio matcher reports a trackId, the UI and the
// downstream queue logic need to know what that track means in the
// context of the live queue. This module joins match results against
// the songs collection on `recognitionMatch.trackId` and returns the
// relevant per-status snapshots.
//
// We deliberately do not auto-mutate songs here. The streaming path is
// about *awareness*; the DJ still has to approve, reject, and send-now
// explicitly. The exception is `bindRecognitionMatchToPending` — that
// only ever enriches an existing PENDING song with a trackId if and only
// if it has no trackId bound yet, so the song becomes eligible to be
// sent now by the DJ. That promotion is opt-in (default off) and is
// driven by the match-session hold state, not by every chunk match.

const { SongModel, AudioTrackModel, EventModel } = require('../../models/schema');
const { logger } = require('../../utils');
const textCrypto = require('../text-crypto');

const ACTIVE_STATUSES = ['PENDING', 'APPROVED', 'PLAYING'];

function normalizeEventId(eventId) {
  return eventId ? String(eventId) : '';
}

function normalizeTrackId(trackId) {
  if (!trackId) return null;
  return String(trackId);
}

async function findQueueContextForTrack(eventId, trackId) {
  const eventIdString = normalizeEventId(eventId);
  const trackIdString = normalizeTrackId(trackId);
  if (!eventIdString || !trackIdString) return null;

  const songs = await SongModel.find({
    eventId: eventIdString,
    'recognitionMatch.trackId': trackIdString,
    status: { $in: ACTIVE_STATUSES },
  })
    .select(
      '_id eventId title artist status queuePosition pinned voteScore ' +
        'startedPlayingAt totalDuration duration recognitionMatch requestedBy createdAt',
    )
    .lean();
  await decryptSongTitles(songs, eventIdString);

  if (!songs.length) {
    return { trackId: trackIdString, songs: [], hasMatch: false, isInQueue: false };
  }

  const pending = songs.find((s) => s.status === 'PENDING') || null;
  const approved = songs
    .filter((s) => s.status === 'APPROVED')
    .sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
  const playing = songs.find((s) => s.status === 'PLAYING') || null;

  return {
    trackId: trackIdString,
    hasMatch: true,
    isInQueue: songs.length > 0,
    hasPlaying: Boolean(playing),
    hasApproved: approved.length > 0,
    hasPending: Boolean(pending),
    pending: pending ? formatQueueSongSummary(pending) : null,
    nextApproved: approved[0] ? formatQueueSongSummary(approved[0]) : null,
    approvedCount: approved.length,
    playing: playing ? formatQueueSongSummary(playing) : null,
    songs: songs.map(formatQueueSongSummary),
  };
}

// Batch version — the match session enriches a small (≤ 5) ranked list
// of candidates per emit, so a single $in query is plenty. We keep the
// results keyed by trackId for O(1) lookup in the socket hot path.
async function enrichMatchesWithQueueContext(eventId, matches) {
  if (!Array.isArray(matches) || matches.length === 0) return [];
  const eventIdString = normalizeEventId(eventId);
  if (!eventIdString) return matches;

  const trackIds = Array.from(
    new Set(
      matches
        .map((m) => normalizeTrackId(m.trackId))
        .filter(Boolean),
    ),
  );
  if (!trackIds.length) return matches;

  const songs = await SongModel.find({
    eventId: eventIdString,
    'recognitionMatch.trackId': { $in: trackIds },
    status: { $in: ACTIVE_STATUSES },
  })
    .select(
      '_id eventId title artist status queuePosition pinned voteScore ' +
        'startedPlayingAt totalDuration duration recognitionMatch requestedBy createdAt',
    )
    .lean();
  await decryptSongTitles(songs, eventIdString);

  const byTrackId = new Map();
  for (const song of songs) {
    const key = String(song.recognitionMatch?.trackId || '');
    if (!key) continue;
    const bucket = byTrackId.get(key) || { pending: null, approved: [], playing: null, songs: [] };
    const summary = formatQueueSongSummary(song);
    bucket.songs.push(summary);
    if (song.status === 'PENDING') bucket.pending = summary;
    if (song.status === 'APPROVED') bucket.approved.push(summary);
    if (song.status === 'PLAYING') bucket.playing = summary;
    byTrackId.set(key, bucket);
  }

  return matches.map((match) => {
    const bucket = byTrackId.get(normalizeTrackId(match.trackId));
    if (!bucket) {
      return {
        ...match,
        queueContext: {
          trackId: match.trackId,
          hasMatch: false,
          isInQueue: false,
          hasPending: false,
          hasApproved: false,
          hasPlaying: false,
        },
      };
    }
    const approvedSorted = [...bucket.approved].sort(
      (a, b) => (a.queuePosition || 0) - (b.queuePosition || 0),
    );
    return {
      ...match,
      queueContext: {
        trackId: match.trackId,
        hasMatch: true,
        isInQueue: true,
        hasPending: Boolean(bucket.pending),
        hasApproved: approvedSorted.length > 0,
        hasPlaying: Boolean(bucket.playing),
        pending: bucket.pending,
        nextApproved: approvedSorted[0] || null,
        approvedCount: approvedSorted.length,
        playing: bucket.playing,
        // Pre-computed hint the UI can show without further joins
        isPlayableNow: Boolean(bucket.playing || approvedSorted[0]),
        suggestedAction: suggestAction(bucket),
      },
    };
  });
}

// Best-effort UX hint. Keeps the decision-support rule in one place so
// the front-end does not have to re-derive it.
function suggestAction(bucket) {
  if (bucket.playing) return 'already_playing';
  if (bucket.approved && bucket.approved.length) return 'send_now';
  if (bucket.pending) return 'awaiting_approval';
  return 'no_queue_entry';
}

// Optional: bind a confirmed trackId to a PENDING song whose
// recognitionMatch.trackId is currently empty. The match session only
// calls this once the candidate has been locked (held + confirmed), so
// we are not auto-binding on every chunk match. Returns the updated
// song (or null if nothing changed).
async function bindRecognitionMatchToPendingSong(eventId, trackId, actor) {
  const eventIdString = normalizeEventId(eventId);
  const trackIdString = normalizeTrackId(trackId);
  if (!eventIdString || !trackIdString) return null;

  const song = await SongModel.findOne({
    eventId: eventIdString,
    status: 'PENDING',
    $or: [
      { 'recognitionMatch.trackId': { $exists: false } },
      { 'recognitionMatch.trackId': null },
      { 'recognitionMatch.trackId': '' },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!song) return null;

  // title/artist are encrypted at rest; decrypt both the song and the
  // candidate track before the fuzzy comparison below. A null return
  // here means the row was written under a stale `authTokenVersion`
  // and cannot be decrypted — we skip the bind rather than risk a
  // false-positive fuzzy match against ciphertext.
  const eventDoc = await EventModel.findById(eventIdString)
    .select('ownerId')
    .lean();
  if (eventDoc) {
    const [songTitle, songArtist] = await textCrypto.decryptFields(eventDoc, [
      song.title,
      song.artist,
    ]);
    if (songTitle !== undefined) song.title = songTitle;
    if (songArtist !== undefined) song.artist = songArtist;
  }

  // Only bind when title/artist from the track actually line up with the
  // song the attendee typed. False-positive track matches must never
  // retitle a PENDING song; the DJ should still review the candidate
  // list manually.
  const track = await AudioTrackModel.findById(trackIdString)
    .select('title artist')
    .lean();
  if (!track) return null;
  if (eventDoc) {
    const [trackTitle, trackArtist] = await textCrypto.decryptFields(eventDoc, [
      track.title,
      track.artist,
    ]);
    if (trackTitle !== undefined) track.title = trackTitle;
    if (trackArtist !== undefined) track.artist = trackArtist;
  }

  const titleClose = fuzzyEquals(song.title, track.title);
  const artistClose = fuzzyEquals(song.artist, track.artist);
  if (!titleClose && !artistClose) {
    logger.debug('Refused to bind fingerprint to PENDING song (title/artist mismatch)', {
      eventId: eventIdString,
      trackId: trackIdString,
      songId: song._id,
      songTitle: song.title,
      songArtist: song.artist,
      trackTitle: track.title,
      trackArtist: track.artist,
    });
    return null;
  }

  const nextMatch = {
    ...(song.recognitionMatch || {}),
    source: song.recognitionMatch?.source || 'fingerprint',
    trackId: trackIdString,
    title: track.title,
    artist: track.artist,
    score: 1,
    matchedOn: 'fingerprint',
    boundAt: new Date(),
  };
  if (eventDoc) {
    const [title, artist] = await Promise.all([
      textCrypto.encryptText(nextMatch.title, eventDoc),
      textCrypto.encryptText(nextMatch.artist, eventDoc),
    ]);
    if (title !== undefined) nextMatch.title = title;
    if (artist !== undefined) nextMatch.artist = artist;
  }

  await SongModel.updateOne(
    { _id: song._id },
    { $set: { recognitionMatch: nextMatch } },
  );
  logger.info('Bound fingerprint to PENDING song', {
    eventId: eventIdString,
    trackId: trackIdString,
    songId: song._id,
    actor: actor?.userId || 'match-session',
  });
  return SongModel.findById(song._id).lean();
}

function fuzzyEquals(a, b) {
  if (!a || !b) return false;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  return norm(a) === norm(b);
}

async function decryptSongTitles(songs, eventId) {
  if (!Array.isArray(songs) || !songs.length || !eventId) return;
  const eventDoc = await EventModel.findById(eventId)
    .select('ownerId')
    .lean();
  if (!eventDoc) return;
  await Promise.all(
    songs.map(async (song) => {
      const [title, artist] = await textCrypto.decryptFields(eventDoc, [
        song.title,
        song.artist,
      ]);
      if (title !== undefined) song.title = title;
      if (artist !== undefined) song.artist = artist;
    }),
  );
}

function formatQueueSongSummary(song) {
  return {
    songId: String(song._id),
    eventId: String(song.eventId),
    title: song.title,
    artist: song.artist,
    status: song.status,
    queuePosition: song.queuePosition ?? null,
    pinned: Boolean(song.pinned),
    voteScore: song.voteScore || 0,
    totalDuration: song.totalDuration ?? song.duration ?? null,
    startedPlayingAt: song.startedPlayingAt || null,
    requestedBy: song.requestedBy || null,
  };
}

module.exports = {
  findQueueContextForTrack,
  enrichMatchesWithQueueContext,
  bindRecognitionMatchToPendingSong,
  ACTIVE_STATUSES,
};
