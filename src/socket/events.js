const { logger } = require('../utils');
const { requireFields } = require('./middleware');

const isValidId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const isValidVoteValue = (v) => v === 1 || v === -1;

// ============ EVENT PARTICIPATION ============

const handleJoinEvent = (socket, io, data) => {
  console.log('Received data:', data);
  console.log('Socket ID:', socket.id);
  const { eventId, participantId, nickname } = data;

  if (!eventId || !participantId) {
    socket.emit('error', { message: 'Invalid event or participant ID' });
    return;
  }

  const room = `event:${eventId}`;
  socket.join(room);
  socket.eventId = eventId;
  socket.participantId = participantId;

  logger.info(`Participant ${participantId} joined event ${eventId}`);
  console.log(`Socket ${socket.id} joined room ${room}`);
  console.log('Socket rooms after join:', socket.rooms);

  io.to(room).emit('participant_joined', {
    participantId,
    nickname,
    joinedAt: new Date().toISOString(),
  });
  console.log('Broadcast complete');
};

const handleLeaveEvent = (socket, io, data) => {
  const { eventId, participantId } = data;

  if (!eventId || !participantId) {
    socket.emit('error', { message: 'Invalid event or participant ID' });
    return;
  }

  socket.leave(`event:${eventId}`);

  logger.info(`Participant ${participantId} left event ${eventId}`);

  io.to(`event:${eventId}`).emit('participant_left', {
    participantId,
    leftAt: new Date().toISOString(),
  });
};

const handleDisconnect = (socket, io) => {
  if (socket.eventId && socket.participantId) {
    io.to(`event:${socket.eventId}`).emit('participant_disconnected', {
      participantId: socket.participantId,
    });
  }
  logger.info(`Socket ${socket.id} disconnected`);
};

// ============ VOTING ============

const handleVotesCast = async (socket, io, data) => {
  const missing = requireFields(data, [
    'eventId',
    'songId',
    'participantId',
    'value',
  ]);
  if (missing) {
    socket.emit('error', { message: `Invalid vote data: ${missing}` });
    return;
  }
  const { eventId, songId, participantId, value } = data;
  if (!isValidId(eventId) || !isValidId(songId) || !isValidId(participantId)) {
    socket.emit('error', { message: 'Invalid id format' });
    return;
  }
  if (!isValidVoteValue(value)) {
    socket.emit('error', { message: 'Vote value must be 1 or -1' });
    return;
  }

  logger.info(`Vote cast: song ${songId}, value ${value}`);

  const { SongModel } = require('../models/schema');
  const song = await SongModel.findById(songId).select('voteScore voteCount');

  io.to(`event:${eventId}`).emit('votes_updated', {
    songId,
    participantId,
    value,
    voteScore: song ? song.voteScore : null,
    voteCount: song ? song.voteCount : null,
    timestamp: new Date().toISOString(),
  });
};

const handleVoteRemoved = (socket, io, data) => {
  const { eventId, songId, participantId } = data;

  if (!eventId || !songId || !participantId) {
    socket.emit('error', { message: 'Invalid vote data' });
    return;
  }

  logger.info(`Vote removed: song ${songId}`);

  io.to(`event:${eventId}`).emit('vote_removed', {
    songId,
    participantId,
    timestamp: new Date().toISOString(),
  });
};

// ============ SONGS ============

const handleSongSuggested = (socket, io, data) => {
  const { eventId, songId, title, artist, participantId } = data;

  if (!eventId || !songId || !title || !artist) {
    socket.emit('error', { message: 'Invalid song data' });
    return;
  }

  logger.info(`Song suggested: ${title} by ${artist}`);

  io.to(`event:${eventId}`).emit('song_suggested', {
    songId,
    title,
    artist,
    participantId,
    timestamp: new Date().toISOString(),
  });
};

const handleSongApproved = async (socket, io, data) => {
  console.log('\n========== BACKEND: SONG APPROVED ==========');
  console.log('Received data:', data);

  const { eventId, songId } = data;
  console.log('Extracted - eventId:', eventId, 'songId:', songId);

  if (!eventId || !songId) {
    logger.error(
      `Invalid song data - eventId: ${eventId}, songId: ${songId}`,
      data,
    );
    socket.emit('error', {
      message: 'Invalid song data',
      details: { eventId: !eventId, songId: !songId },
    });
    return;
  }

  logger.info(`Song approved: ${songId}`);
  console.log('Fetching song details for:', songId);

  // Get song details to send with the event
  const { SongModel } = require('../models/schema');
  const song = await SongModel.findById(songId).select('title artist');
  console.log('Song found:', song);

  const eventRoom = `event:${eventId}`;
  console.log(`Broadcasting to room: ${eventRoom}`);
  io.to(eventRoom).emit('song_approved', {
    songId,
    title: song?.title || 'Unknown',
    artist: song?.artist || 'Unknown',
    timestamp: new Date().toISOString(),
  });
  console.log('Broadcast complete');
};

const handleSongRejected = (socket, io, data) => {
  console.log('\n========== BACKEND: SONG REJECTED ==========');
  console.log('Received data:', data);

  const { eventId, songId, reason } = data;

  if (!eventId || !songId) {
    logger.error(
      `Invalid song data - eventId: ${eventId}, songId: ${songId}`,
      data,
    );
    socket.emit('error', {
      message: 'Invalid song data',
      details: { eventId: !eventId, songId: !songId },
    });
    return;
  }

  logger.info(`Song rejected: ${songId}`);

  const eventRoom = `event:${eventId}`;
  console.log(`Broadcasting to room: ${eventRoom}`, { songId, reason });
  io.to(eventRoom).emit('song_rejected', {
    songId,
    reason,
    timestamp: new Date().toISOString(),
  });
  console.log('Broadcast complete');
};

const handleSongSkipped = (socket, io, data) => {
  const { eventId, songId, reason } = data;

  if (!eventId || !songId) {
    logger.error(
      `Invalid song data - eventId: ${eventId}, songId: ${songId}`,
      data,
    );
    socket.emit('error', {
      message: 'Invalid song data',
      details: { eventId: !eventId, songId: !songId },
    });
    return;
  }

  logger.info(`Song skipped: ${songId}`);

  io.to(`event:${eventId}`).emit('song_skipped', {
    songId,
    reason,
    timestamp: new Date().toISOString(),
  });
};

const handleQueueUpdated = (socket, io, data) => {
  const { eventId, queue } = data;

  if (!eventId || !queue) {
    socket.emit('error', { message: 'Invalid queue data' });
    return;
  }

  logger.info(`Queue updated for event ${eventId}`);

  io.to(`event:${eventId}`).emit('queue_updated', {
    queue,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  handleJoinEvent,
  handleLeaveEvent,
  handleDisconnect,
  handleVotesCast,
  handleVoteRemoved,
  handleSongSuggested,
  handleSongApproved,
  handleSongRejected,
  handleSongSkipped,
  handleQueueUpdated,
};
