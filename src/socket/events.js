const { logger } = require('../utils');
const { requireFields } = require('./middleware');
const { validateTransition } = require('../utils/song-state-machine');
const { songsService, votesService, participantsService } = require('../services');

const isValidId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const isValidVoteValue = (v) => v === 1 || v === -1;

/* ============ EVENT PARTICIPATION ============ */

const handleJoinEvent = async (socket, io, data) => {
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

  let profilePicture = data.profilePicture || null;
  if (!profilePicture) {
    try {
      const participant = await participantsService.getParticipant(participantId);
      profilePicture = participant.profilePicture || null;
    } catch (error) {
      logger.warn(`Unable to load participant picture for socket join: ${participantId}`);
    }
  }

  io.to(room).emit('participant_joined', {
    participantId,
    nickname,
    profilePicture,
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

/* ============ VOTING ============ */

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

/* ============ SONGS ============ */

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
  const { eventId, songId } = data;

  if (!eventId || !songId) {
    logger.error(`Invalid song data - eventId: ${eventId}, songId: ${songId}`, data);
    socket.emit('error', {
      message: 'Invalid song data',
      details: { eventId: !eventId, songId: !songId },
    });
    return;
  }

  try {
    const { SongModel } = require('../models/schema');
    const song = await SongModel.findById(songId).select('title artist status eventId');

    if (!song) {
      socket.emit('error', { message: 'Song not found' });
      return;
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'APPROVED', 'DJ');

    /* Update song status */
    song.status = 'APPROVED';
    await song.save();

    logger.info(`Song approved: ${songId}`, {
      eventId,
      songId,
      action: 'SONG_APPROVE',
    });

    /* Broadcast to event room */
    io.to(`event:${eventId}`).emit('song_approved', {
      songId,
      title: song.title,
      artist: song.artist,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in song_approved:', error);
    socket.emit('error', {
      message: error.message || 'Error approving song',
    });
  }
};

const handleSongRejected = async (socket, io, data) => {
  const { eventId, songId, reason } = data;

  if (!eventId || !songId) {
    logger.error(`Invalid song data - eventId: ${eventId}, songId: ${songId}`, data);
    socket.emit('error', {
      message: 'Invalid song data',
      details: { eventId: !eventId, songId: !songId },
    });
    return;
  }

  try {
    const { SongModel } = require('../models/schema');
    const song = await SongModel.findById(songId).select('status');

    if (!song) {
      socket.emit('error', { message: 'Song not found' });
      return;
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'REJECTED', 'DJ');

    /* Update song status */
    song.status = 'REJECTED';
    await song.save();

    logger.info(`Song rejected: ${songId}`, {
      eventId,
      songId,
      action: 'SONG_REJECT',
      reason,
    });

    /* Broadcast to event room */
    io.to(`event:${eventId}`).emit('song_rejected', {
      songId,
      reason,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in song_rejected:', error);
    socket.emit('error', {
      message: error.message || 'Error rejecting song',
    });
  }
};

const handleSongSkipped = async (socket, io, data) => {
  const { eventId, songId, reason } = data;

  if (!eventId || !songId) {
    logger.error(`Invalid song data - eventId: ${eventId}, songId: ${songId}`, data);
    socket.emit('error', {
      message: 'Invalid song data',
      details: { eventId: !eventId, songId: !songId },
    });
    return;
  }

  try {
    const { SongModel } = require('../models/schema');
    const song = await SongModel.findById(songId).select('status');

    if (!song) {
      socket.emit('error', { message: 'Song not found' });
      return;
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'SKIPPED', 'DJ');

    /* Update song status */
    song.status = 'SKIPPED';
    song.skippedAt = new Date();
    song.skippedReason = reason;
    await song.save();

    logger.info(`Song skipped: ${songId}`, {
      eventId,
      songId,
      action: 'SONG_SKIP',
      reason,
    });

    /* Broadcast to event room */
    io.to(`event:${eventId}`).emit('song_skipped', {
      songId,
      reason,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in song_skipped:', error);
    socket.emit('error', {
      message: error.message || 'Error skipping song',
    });
  }
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

/* ============ PARTICIPANTS ============ */

const handleParticipantCooldown = async (socket, io, data) => {
  const { eventId, participantId, reason } = data;

  if (!eventId || !participantId) {
    logger.error(`Invalid participant data - eventId: ${eventId}, participantId: ${participantId}`);
    socket.emit('error', {
      message: 'Invalid participant data',
    });
    return;
  }

  try {
    logger.info(`Participant cooldown set: ${participantId}`, {
      eventId,
      participantId,
      action: 'PARTICIPANT_COOLDOWN',
      reason,
    });

    /* Broadcast to event room */
    io.to(`event:${eventId}`).emit('participant_cooldown', {
      participantId,
      reason,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in participant_cooldown:', error);
    socket.emit('error', {
      message: error.message || 'Error setting cooldown',
    });
  }
};

const handleParticipantKicked = async (socket, io, data) => {
  const { eventId, participantId, reason } = data;

  if (!eventId || !participantId) {
    logger.error(`Invalid participant data - eventId: ${eventId}, participantId: ${participantId}`);
    socket.emit('error', {
      message: 'Invalid participant data',
    });
    return;
  }

  try {
    logger.info(`Participant kicked: ${participantId}`, {
      eventId,
      participantId,
      action: 'PARTICIPANT_KICKED',
      reason,
    });

    /* Broadcast to event room */
    io.to(`event:${eventId}`).emit('participant_kicked', {
      participantId,
      reason,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in participant_kicked:', error);
    socket.emit('error', {
      message: error.message || 'Error kicking participant',
    });
  }
};

const handleSongNowPlaying = async (socket, io, data) => {
  const { eventId, songId, title, artist } = data;

  if (!eventId || !songId || !title || !artist) {
    logger.error(`Invalid song data for now_playing`, data);
    socket.emit('error', {
      message: 'Invalid song data',
    });
    return;
  }

  try {
    logger.info(`Song now playing: ${title} by ${artist}`, {
      eventId,
      songId,
      action: 'SONG_NOW_PLAYING',
    });

    /* Broadcast to event room */
    io.to(`event:${eventId}`).emit('song_now_playing', {
      songId,
      title,
      artist,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in song_now_playing:', error);
    socket.emit('error', {
      message: error.message || 'Error setting song as playing',
    });
  }
};

/* ============ SOCKET.IO PRIMARY STATE CHANGES ============ */

/**
 * Handle suggest_song event - PRIMARY entry point
 * @param {Socket} socket
 * @param {Server} io
 * @param {Object} data - { eventId, participantId, title, artist }
 * @param {Function} callback - Acknowledgment callback (success, error)
 */
const handleSuggestSong = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, title, artist } = data;

    // Validation
    if (!eventId || !participantId || !title || !artist) {
      throw new Error('Missing required fields: eventId, participantId, title, artist');
    }

    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    // Call service (same as REST would)
    const song = await songsService.suggestSong(eventId, participantId, title, artist);

    // Broadcast to room
    io.to(`event:${eventId}`).emit('song_suggested', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      requestedBy: song.requestedBy,
      timestamp: new Date().toISOString(),
    });

    logger.info('Song suggested via Socket.IO', { songId: song._id, eventId });

    // Acknowledge to sender with result
    callback({ success: true, data: song, error: null });
  } catch (error) {
    logger.error('Error suggesting song via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle approve_song event - PRIMARY entry point
 */
const handleApproveSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, userId } = data;

    if (!eventId || !songId || !userId) {
      throw new Error('Missing required fields: eventId, songId, userId');
    }

    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(userId)) {
      throw new Error('Invalid ID format');
    }

    const song = await songsService.approveSong(songId, eventId, userId);

    io.to(`event:${eventId}`).emit('song_approved', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      status: song.status,
      timestamp: new Date().toISOString(),
    });

    logger.info('Song approved via Socket.IO', { songId, eventId });
    callback({ success: true, data: song, error: null });
  } catch (error) {
    logger.error('Error approving song via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle reject_song event - PRIMARY entry point
 */
const handleRejectSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, reason, userId } = data;

    if (!eventId || !songId || !userId) {
      throw new Error('Missing required fields: eventId, songId, userId');
    }

    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(userId)) {
      throw new Error('Invalid ID format');
    }

    const song = await songsService.rejectSong(songId, eventId, reason, userId);

    io.to(`event:${eventId}`).emit('song_rejected', {
      songId: song._id,
      status: song.status,
      reason,
      timestamp: new Date().toISOString(),
    });

    logger.info('Song rejected via Socket.IO', { songId, eventId, reason });
    callback({ success: true, data: song, error: null });
  } catch (error) {
    logger.error('Error rejecting song via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle skip_song event - PRIMARY entry point
 */
const handleSkipSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, reason, userId } = data;

    if (!eventId || !songId || !userId) {
      throw new Error('Missing required fields: eventId, songId, userId');
    }

    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(userId)) {
      throw new Error('Invalid ID format');
    }

    const song = await songsService.skipSong(songId, eventId, reason, userId);

    io.to(`event:${eventId}`).emit('song_skipped', {
      songId: song._id,
      status: song.status,
      reason,
      timestamp: new Date().toISOString(),
    });

    logger.info('Song skipped via Socket.IO', { songId, eventId, reason });
    callback({ success: true, data: song, error: null });
  } catch (error) {
    logger.error('Error skipping song via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle send_now event - PRIMARY entry point
 */
const handleSendNow = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, userId } = data;

    if (!eventId || !songId || !userId) {
      throw new Error('Missing required fields: eventId, songId, userId');
    }

    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(userId)) {
      throw new Error('Invalid ID format');
    }

    const song = await songsService.sendNow(songId, eventId, userId);

    io.to(`event:${eventId}`).emit('song_now_playing', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      status: song.status,
      timestamp: new Date().toISOString(),
    });

    logger.info('Song sent now via Socket.IO', { songId, eventId });
    callback({ success: true, data: song, error: null });
  } catch (error) {
    logger.error('Error sending song now via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle cast_vote event - PRIMARY entry point
 */
const handleCastVote = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, participantId, value } = data;

    if (!eventId || !songId || !participantId) {
      throw new Error('Missing required fields: eventId, songId, participantId, value');
    }

    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    if (!isValidVoteValue(value)) {
      throw new Error('Vote value must be 1 or -1');
    }

    const vote = await votesService.castVote(songId, participantId, value);

    io.to(`event:${eventId}`).emit('vote_cast', {
      songId,
      participantId,
      value,
      voteScore: vote.song?.voteScore,
      voteCount: vote.song?.voteCount,
      timestamp: new Date().toISOString(),
    });

    logger.info('Vote cast via Socket.IO', { songId, participantId, value });
    callback({ success: true, data: vote, error: null });
  } catch (error) {
    logger.error('Error casting vote via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle remove_vote event - PRIMARY entry point
 */
const handleRemoveVote = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, participantId } = data;

    if (!eventId || !songId || !participantId) {
      throw new Error('Missing required fields: eventId, songId, participantId');
    }

    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    const vote = await votesService.removeVote(songId, participantId);

    io.to(`event:${eventId}`).emit('vote_removed', {
      songId,
      participantId,
      timestamp: new Date().toISOString(),
    });

    logger.info('Vote removed via Socket.IO', { songId, participantId });
    callback({ success: true, data: vote, error: null });
  } catch (error) {
    logger.error('Error removing vote via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle set_cooldown event - PRIMARY entry point
 */
const handleSetCooldown = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, durationMs, reason, userId } = data;

    if (!eventId || !participantId || !durationMs || !userId) {
      throw new Error('Missing required fields: eventId, participantId, durationMs, userId');
    }

    if (!isValidId(eventId) || !isValidId(participantId) || !isValidId(userId)) {
      throw new Error('Invalid ID format');
    }

    const result = await participantsService.setParticipantCooldown(
      participantId,
      durationMs,
      reason || 'Administrative action',
      userId,
    );

    io.to(`event:${eventId}`).emit('participant_cooldown', {
      participantId,
      reason: reason || 'Administrative action',
      cooldownUntil:
        result.participant.cooldownUntil instanceof Date
          ? result.participant.cooldownUntil.toISOString()
          : result.participant.cooldownUntil,
      timestamp: new Date().toISOString(),
    });

    logger.info('Cooldown set via Socket.IO', { participantId, eventId, durationMs });
    callback({ success: true, data: result.participant, error: null });
  } catch (error) {
    logger.error('Error setting cooldown via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle kick_participant event - PRIMARY entry point
 */
const handleKickParticipant = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, reason, userId } = data;

    if (!eventId || !participantId || !userId) {
      throw new Error('Missing required fields: eventId, participantId, userId');
    }

    if (!isValidId(eventId) || !isValidId(participantId) || !isValidId(userId)) {
      throw new Error('Invalid ID format');
    }

    const result = await participantsService.kickParticipant(
      participantId,
      reason || 'No reason provided',
      userId,
    );

    io.to(`event:${eventId}`).emit('participant_kicked', {
      participantId,
      reason: reason || 'No reason provided',
      kickedAt:
        result.participant.leftAt instanceof Date
          ? result.participant.leftAt.toISOString()
          : result.participant.leftAt,
      timestamp: new Date().toISOString(),
    });

    logger.info('Participant kicked via Socket.IO', { participantId, eventId });
    callback({ success: true, data: result.participant, error: null });
  } catch (error) {
    logger.error('Error kicking participant via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
};

/**
 * Handle set_premium event - PRIMARY entry point
 */
const handleSetPremium = async (socket, io, data, callback) => {
  try {
    const { participantId, isPremium } = data;

    if (!participantId || typeof isPremium !== 'boolean') {
      throw new Error('Missing required fields: participantId, isPremium');
    }

    if (!isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    const participant = await participantsService.setPremium(participantId, isPremium);

    // Get event ID for broadcasting
    const eventId = participant.eventId?.toString() || '';

    if (eventId) {
      io.to(`event:${eventId}`).emit('participant_premium_updated', {
        participantId,
        isPremium,
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('Premium status set via Socket.IO', { participantId, isPremium });
    callback({ success: true, data: participant, error: null });
  } catch (error) {
    logger.error('Error setting premium via Socket.IO:', error);
    callback({ success: false, data: null, error: error.message });
  }
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
  handleParticipantCooldown,
  handleParticipantKicked,
  handleSongNowPlaying,
  // Socket.IO Primary State Changes
  handleSuggestSong,
  handleApproveSong,
  handleRejectSong,
  handleSkipSong,
  handleSendNow,
  handleCastVote,
  handleRemoveVote,
  handleSetCooldown,
  handleKickParticipant,
  handleSetPremium,
};
