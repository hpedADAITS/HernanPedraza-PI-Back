// Song state-change handlers: suggest, approve, reject, skip, sendNow.
// Plus the legacy "broadcast only" stubs (these reject client-emitted
// commands that the server is supposed to broadcast, not receive).

const { logger } = require('../utils');
const { ackSuccess, ackError } = require('./ack');
const { songsService } = require('../services');
const { SongModel } = require('../models/schema');
const { validateTransition } = require('../utils/song-state-machine');
const { assertJoinedEvent, eventActor, emitQueueUpdated, rejectLegacyCommand, toEventRoom } = require('./room');
const { isValidId } = require('./shared-validators');

const handleSuggestSong = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, title, artist, totalDuration, duration, userId } = data;
    if (!eventId || !participantId || !title || !artist) {
      throw new Error('Missing required fields: eventId, participantId, title, artist');
    }
    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }
    await assertJoinedEvent(socket, eventId, participantId);
    const song = await songsService.suggestSong(
      eventId, participantId, title, artist, totalDuration ?? duration, eventActor(socket, userId),
    );
    toEventRoom(io, eventId).emit('song_suggested', {
      songId: song._id, title: song.title, artist: song.artist,
      requestedBy: song.requestedBy, status: song.status,
      totalDuration: song.totalDuration, duration: song.duration,
      timestamp: new Date().toISOString(),
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
      songId: song._id, title: song.title, artist: song.artist,
      recognitionMatch: song.recognitionMatch || null, status: song.status,
      totalDuration: song.totalDuration || 0, duration: song.duration || 0,
      playingStartedAt: song.playingStartedAt || song.startedPlayingAt,
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

// Legacy broadcast-only stubs. The server broadcasts these from the primary
// handlers (above); the client must not be able to emit them.
const handleSongSuggested = (socket, io, data) => {
  const { eventId, songId, title, artist, participantId } = data;
  if (!eventId || !songId || !title || !artist) {
    socket.emit('error', { message: 'Invalid song data' });
    return;
  }
  logger.info(`Song suggested: ${title} by ${artist}`);
  toEventRoom(io, eventId).emit('song_suggested', {
    songId, title, artist, participantId, timestamp: new Date().toISOString(),
  });
};

const handleSongApproved = async (socket, io, data) => {
  const { eventId, songId } = data;
  if (!eventId || !songId) {
    socket.emit('error', { message: 'Invalid song data' });
    return;
  }
  try {
    const song = await SongModel.findById(songId).select('title artist status eventId');
    if (!song) {
      socket.emit('error', { message: 'Song not found' });
      return;
    }
    validateTransition(song.status, 'APPROVED', 'DJ');
    song.status = 'APPROVED';
    await song.save();
    logger.info(`Song approved: ${songId}`, { eventId, songId, action: 'SONG_APPROVE' });
    toEventRoom(io, eventId).emit('song_approved', {
      songId, title: song.title, artist: song.artist, status: song.status,
      timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
  } catch (error) {
    logger.error('Error in song_approved:', error);
    socket.emit('error', { message: error.message || 'Error approving song' });
  }
};

const handleSongRejected = async (socket, io, data) => {
  const { eventId, songId, reason } = data;
  if (!eventId || !songId) {
    socket.emit('error', { message: 'Invalid song data' });
    return;
  }
  try {
    const song = await SongModel.findById(songId).select('status');
    if (!song) {
      socket.emit('error', { message: 'Song not found' });
      return;
    }
    validateTransition(song.status, 'REJECTED', 'DJ');
    song.status = 'REJECTED';
    await song.save();
    logger.info(`Song rejected: ${songId}`, { eventId, songId, action: 'SONG_REJECT', reason });
    toEventRoom(io, eventId).emit('song_rejected', {
      songId, reason, timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
  } catch (error) {
    logger.error('Error in song_rejected:', error);
    socket.emit('error', { message: error.message || 'Error rejecting song' });
  }
};

const handleSongSkipped = async (socket, io, data) => {
  const { eventId, songId, reason } = data;
  if (!eventId || !songId) {
    socket.emit('error', { message: 'Invalid song data' });
    return;
  }
  try {
    const song = await SongModel.findById(songId).select('status');
    if (!song) {
      socket.emit('error', { message: 'Song not found' });
      return;
    }
    validateTransition(song.status, 'SKIPPED', 'DJ');
    song.status = 'SKIPPED';
    song.skippedAt = new Date();
    song.skippedReason = reason;
    await song.save();
    logger.info(`Song skipped: ${songId}`, { eventId, songId, action: 'SONG_SKIP', reason });
    toEventRoom(io, eventId).emit('song_skipped', {
      songId, reason, timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
  } catch (error) {
    logger.error('Error in song_skipped:', error);
    socket.emit('error', { message: error.message || 'Error skipping song' });
  }
};

const handleSongNowPlaying = async (socket, io, data) => {
  const { eventId, songId, title, artist, totalDuration, duration, recognitionMatch } = data;
  if (!eventId || !songId || !title || !artist) {
    socket.emit('error', { message: 'Invalid song data' });
    return;
  }
  try {
    logger.info(`Song now playing: ${title} by ${artist}`, { eventId, songId, action: 'SONG_NOW_PLAYING' });
    toEventRoom(io, eventId).emit('song_now_playing', {
      songId, title, artist,
      recognitionMatch: recognitionMatch || null,
      totalDuration: totalDuration ?? duration,
      duration: totalDuration ?? duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in song_now_playing:', error);
    socket.emit('error', { message: error.message || 'Error setting song as playing' });
  }
};

const handleQueueUpdated = (socket, io, data) => {
  const { eventId, queue } = data;
  if (!eventId || !queue) {
    socket.emit('error', { message: 'Invalid queue data' });
    return;
  }
  logger.info(`Queue updated for event ${eventId}`);
  toEventRoom(io, eventId).emit('queue_updated', {
    eventId, queue, timestamp: new Date().toISOString(),
  });
};

module.exports = {
  handleSuggestSong,
  handleApproveSong,
  handleRejectSong,
  handleSkipSong,
  handleSendNow,
  handleSongSuggested,
  handleSongApproved,
  handleSongRejected,
  handleSongSkipped,
  handleSongNowPlaying,
  handleQueueUpdated,
  rejectLegacyCommand,
};
