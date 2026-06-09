// Song state-change handlers: suggest, approve, reject, skip, sendNow.
const { logger } = require('../utils');
const { buildNowPlayingPayload } = require('../utils/now-playing');
const { ackSuccess, ackError } = require('./ack');
const { songsService } = require('../services');
const { assertJoinedEvent, eventActor, emitQueueUpdated, rejectLegacyCommand, toEventRoom } = require('./room');
const { isValidId } = require('./shared-validators');
const { songsSchema } = require('../schemas');
const matchSessionRegistry = require('../services/audio-recognition/match-session-registry');

// Whenever we fan out a queue-related event to the room, also notify
// the in-process match-session registry so every live audio match
// stream can re-evaluate the queue context for its current candidate.
async function notifyMatchSessions(eventId, type, payload) {
  if (!eventId || !type) return;
  await matchSessionRegistry.applyQueueEventToEvent(eventId, {
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

const handleSuggestSong = async (socket, io, data, callback) => {
  try {
    const {
      eventId,
      participantId,
      title,
      artist,
      userId,
    } = data;
    if (!eventId || !participantId || !title || !artist) {
      throw new Error('Missing required fields: eventId, participantId, title, artist');
    }
    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }
    const parsed = songsSchema.parseSuggestSong(data);
    await assertJoinedEvent(socket, eventId, participantId);
    const song = await songsService.suggestSong(
      eventId,
      parsed.participantId,
      parsed.title,
      parsed.artist,
      parsed.totalDuration,
      eventActor(socket, userId),
      {
        musicBrainzConfirmed: parsed.musicBrainzConfirmed,
        musicBrainzMatch: parsed.musicBrainzMatch,
        skipMusicBrainzLookup: parsed.skipMusicBrainzLookup,
        fingerprintTrackId: parsed.fingerprintTrackId,
      },
    );
    toEventRoom(io, eventId).emit('song_suggested', {
      songId: song._id, title: song.title, artist: song.artist,
      requestedBy: song.requestedBy, recognitionMatch: song.recognitionMatch || null, status: song.status,
      totalDuration: song.totalDuration, duration: song.duration,
      timestamp: new Date().toISOString(),
    });
    await notifyMatchSessions(eventId, 'song_suggested', {
      songId: song._id,
      status: song.status,
      trackId: song.recognitionMatch?.trackId || null,
    });
    logger.info('Song suggested via Socket.IO', { songId: song._id, eventId });
    ackSuccess(callback, song);
  } catch (error) {
    logger.error('Error suggesting song via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleApproveSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, userId } = data;
    const actor = eventActor(socket, userId);
    if (!eventId || !songId || !actor) throw new Error('Missing required fields: eventId, songId');
    if (!isValidId(eventId) || !isValidId(songId)) throw new Error('Invalid ID format');
    await assertJoinedEvent(socket, eventId);
    const song = await songsService.approveSong(songId, eventId, actor);
    toEventRoom(io, eventId).emit('song_approved', {
      songId: song._id, title: song.title, artist: song.artist,
      recognitionMatch: song.recognitionMatch || null, status: song.status,
      totalDuration: song.totalDuration, duration: song.duration,
      timestamp: new Date().toISOString(),
    });
    await notifyMatchSessions(eventId, 'song_approved', {
      songId: song._id,
      status: song.status,
      trackId: song.recognitionMatch?.trackId || null,
    });
    await emitQueueUpdated(io, eventId);
    logger.info('Song approved via Socket.IO', { songId, eventId });
    ackSuccess(callback, song);
  } catch (error) {
    logger.error('Error approving song via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleRejectSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, reason, userId } = data;
    const actor = eventActor(socket, userId);
    if (!eventId || !songId || !actor) throw new Error('Missing required fields: eventId, songId');
    if (!isValidId(eventId) || !isValidId(songId)) throw new Error('Invalid ID format');
    await assertJoinedEvent(socket, eventId);
    const song = await songsService.rejectSong(songId, eventId, reason, actor);
    toEventRoom(io, eventId).emit('song_rejected', {
      songId: song._id, title: song.title, artist: song.artist,
      status: song.status, reason,
      timestamp: new Date().toISOString(),
    });
    await notifyMatchSessions(eventId, 'song_rejected', {
      songId: song._id,
      status: song.status,
      trackId: song.recognitionMatch?.trackId || null,
    });
    await emitQueueUpdated(io, eventId);
    logger.info('Song rejected via Socket.IO', { songId, eventId, reason });
    ackSuccess(callback, song);
  } catch (error) {
    logger.error('Error rejecting song via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleSkipSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, reason, userId } = data;
    const actor = eventActor(socket, userId);
    if (!eventId || !songId || !actor) throw new Error('Missing required fields: eventId, songId');
    if (!isValidId(eventId) || !isValidId(songId)) throw new Error('Invalid ID format');
    await assertJoinedEvent(socket, eventId);
    const song = await songsService.skipSong(songId, eventId, reason, actor);
    toEventRoom(io, eventId).emit('song_skipped', {
      songId: song._id, title: song.title, artist: song.artist,
      status: song.status, reason,
      timestamp: new Date().toISOString(),
    });
    await notifyMatchSessions(eventId, 'song_skipped', {
      songId: song._id,
      status: song.status,
      trackId: song.recognitionMatch?.trackId || null,
    });
    await emitQueueUpdated(io, eventId);
    logger.info('Song skipped via Socket.IO', { songId, eventId, reason });
    ackSuccess(callback, song);
  } catch (error) {
    logger.error('Error skipping song via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleSendNow = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, userId } = data;
    const actor = eventActor(socket, userId);
    if (!eventId || !songId || !actor) throw new Error('Missing required fields: eventId, songId');
    if (!isValidId(eventId) || !isValidId(songId)) throw new Error('Invalid ID format');
    await assertJoinedEvent(socket, eventId);
    const song = await songsService.sendNow(songId, eventId, actor);
    toEventRoom(io, eventId).emit('song_now_playing', {
      ...buildNowPlayingPayload(song),
      status: song.status,
      timestamp: new Date().toISOString(),
    });
    await notifyMatchSessions(eventId, 'song_now_playing', {
      songId: song._id,
      status: song.status,
      trackId: song.recognitionMatch?.trackId || null,
    });
    await emitQueueUpdated(io, eventId);
    logger.info('Song sent now via Socket.IO', { songId, eventId });
    ackSuccess(callback, song);
  } catch (error) {
    logger.error('Error sending song now via Socket.IO:', error);
    ackError(callback, error);
  }
};

// Legacy broadcast stubs — registered as rejectLegacyCommand in handlers.js.
// Their bodies are never executed; only the rejector runs.

module.exports = {
  handleSuggestSong,
  handleApproveSong,
  handleRejectSong,
  handleSkipSong,
  handleSendNow,
  rejectLegacyCommand,
};
