// Song state-change handlers: suggest, approve, reject, skip, sendNow.

const { logger } = require('../utils');
const { ackSuccess, ackError } = require('./ack');
const { songsService } = require('../services');
const { assertJoinedEvent, eventActor, emitQueueUpdated, rejectLegacyCommand, toEventRoom } = require('./room');
const { isValidId } = require('./shared-validators');

const handleSuggestSong = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, title, artist, totalDuration, userId } = data;
    if (!eventId || !participantId || !title || !artist) {
      throw new Error('Missing required fields: eventId, participantId, title, artist');
    }
    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }
    await assertJoinedEvent(socket, eventId, participantId);
    const song = await songsService.suggestSong(
      eventId, participantId, title, artist, totalDuration, eventActor(socket, userId),
    );
    toEventRoom(io, eventId).emit('song_suggested', {
      songId: song.id, title: song.title, artist: song.artist,
      requestedBy: song.requestedBy, status: song.status,
      totalDuration: song.totalDuration,
      timestamp: new Date().toISOString(),
    });
    logger.info('Song suggested via Socket.IO', { songId: song.id, eventId });
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
      songId: song.id, title: song.title, artist: song.artist,
      recognitionMatch: song.recognitionMatch || null, status: song.status,
      totalDuration: song.totalDuration,
      timestamp: new Date().toISOString(),
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
      songId: song.id, title: song.title, artist: song.artist,
      status: song.status, reason,
      timestamp: new Date().toISOString(),
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
      songId: song.id, title: song.title, artist: song.artist,
      status: song.status, reason,
      timestamp: new Date().toISOString(),
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
      songId: song.id, title: song.title, artist: song.artist,
      recognitionMatch: song.recognitionMatch || null, status: song.status,
      startedAt: song.startedAt || null,
      totalDuration: song.totalDuration || 0,
      timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
    logger.info('Song sent now via Socket.IO', { songId, eventId });
    ackSuccess(callback, song);
  } catch (error) {
    logger.error('Error sending song now via Socket.IO:', error);
    ackError(callback, error);
  }
};

module.exports = {
  handleSuggestSong,
  handleApproveSong,
  handleRejectSong,
  handleSkipSong,
  handleSendNow,
  rejectLegacyCommand,
};
