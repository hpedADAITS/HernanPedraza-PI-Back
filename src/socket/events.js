const { logger } = require('../utils');
const { requireFields } = require('./middleware');
const {
  isInEventRoom,
  joinEventRoom,
  leaveEventRoom,
  toEventRoom,
} = require('./rooms');
const { ackSuccess, ackError } = require('./ack');
const { validateTransition } = require('../utils/song-state-machine');
const {
  audioTracksService,
  songsService,
  votesService,
  participantsService,
  sharedRamMatcher,
} = require('../services');
const { SongModel } = require('../models/schema');
const {
  TARGET_SAMPLE_RATE,
  resampleLinear,
} = require('../services/audio-recognition/wav');
const {
  StreamingFingerprinter,
} = require('../services/audio-recognition/streaming');
const {
  assertEventRoomAccess,
  isSocketAuthOptional,
  socketActor,
  socketUserId,
} = require('./auth');

const isValidId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const isValidVoteValue = (v) => v === 1 || v === -1;

const eventActor = (socket, payloadUserId) => {
  const actor = socketActor(socket, payloadUserId);
  if (!actor) throw new Error('Socket authentication is required');
  return actor;
};

const assertJoinedEvent = async (socket, eventId, participantId) => {
  if (isSocketAuthOptional(socket)) return;
  if (isInEventRoom(socket, eventId)) return;
  await assertEventRoomAccess(socket, eventId, participantId);
};

const rejectLegacyCommand = (socket, eventName) => {
  logger.warn(`Rejected client-emitted legacy socket event: ${eventName}`, {
    socketId: socket.id,
    userId: socketUserId(socket),
  });
  socket.emit('error', {
    message: `${eventName} is a server broadcast event and cannot be used as a command`,
  });
};

const assertAudioEventAccess = async (socket, eventId) => {
  if (!isValidId(eventId)) throw new Error('Invalid event ID');
  if (
    socket.user?.type === 'phone-microphone' &&
    socket.user.eventId !== eventId
  ) {
    throw new Error('Invalid phone microphone token');
  }
  await audioTracksService.listTracks(eventId, socket.user);
};

const float32 = (data) => {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const out = new Float32Array(buffer.length >>> 2);
  for (let i = 0; i < out.length; i++) out[i] = buffer.readFloatLE(i << 2);
  return out;
};

const extractFloat32Pcm = (payload) => {
  if (payload instanceof Float32Array) {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return new Float32Array(payload);
  }

  if (Buffer.isBuffer(payload)) {
    if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Invalid Float32 PCM byte length: ${payload.byteLength}`);
    }

    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }

  if (ArrayBuffer.isView(payload)) {
    if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Invalid typed PCM byte length: ${payload.byteLength}`);
    }

    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }

  throw new Error(`Unsupported audio chunk payload: ${typeof payload}`);
};

const emitQueueUpdated = async (io, eventId) => {
  const snapshot = await songsService.getQueueSnapshotForEvent(eventId);
  toEventRoom(io, eventId).emit('queue_updated', {
    eventId,
    ...snapshot,
    timestamp: new Date().toISOString(),
  });
};

/* ============ EVENT PARTICIPATION ============ */

const handleJoinEvent = async (socket, io, data) => {
  if (!data || typeof data !== 'object') {
    socket.emit('error', { message: 'Invalid event ID' });
    return;
  }

  const { eventId, participantId, nickname } = data;

  if (!eventId) {
    socket.emit('error', { message: 'Invalid event ID' });
    return;
  }

  const authorizedParticipant = await assertEventRoomAccess(
    socket,
    eventId,
    participantId,
  );

  joinEventRoom(socket, eventId);
  socket.eventId = eventId;
  socket.participantId =
    authorizedParticipant?._id?.toString() || participantId || null;

  logger.info(`Socket joined event ${eventId}`, {
    participantId: socket.participantId,
    userId: socketUserId(socket),
  });

  let profilePicture =
    authorizedParticipant?.profilePicture || data.profilePicture || null;
  if (participantId && !profilePicture && !isSocketAuthOptional(socket)) {
    try {
      const participant =
        await participantsService.getParticipant(participantId);
      profilePicture = participant.profilePicture || null;
    } catch (error) {
      logger.warn(
        `Unable to load participant picture for socket join: ${participantId}`,
      );
    }
  }

  if (participantId) {
    toEventRoom(io, eventId).emit('participant_joined', {
      participantId,
      nickname,
      profilePicture,
      joinedAt: new Date().toISOString(),
    });
  }
};

const handleLeaveEvent = (socket, io, data) => {
  const { eventId, participantId } = data;

  if (!eventId || !participantId) {
    socket.emit('error', { message: 'Invalid event or participant ID' });
    return;
  }

  leaveEventRoom(socket, eventId);

  logger.info(`Participant ${participantId} left event ${eventId}`);

  toEventRoom(io, eventId).emit('participant_left', {
    participantId,
    leftAt: new Date().toISOString(),
  });
};

const handleDisconnect = (socket, io) => {
  if (socket.eventId && socket.participantId) {
    toEventRoom(io, socket.eventId).emit('participant_disconnected', {
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

  await assertJoinedEvent(socket, eventId, participantId);

  logger.info(`Vote cast: song ${songId}, value ${value}`);

  const result = await votesService.castVote(
    songId,
    participantId,
    value,
    socket.user,
  );
  const song = result.song;

  toEventRoom(io, eventId).emit('votes_updated', {
    songId,
    participantId,
    value,
    voteScore: song ? song.voteScore : null,
    voteCount: song ? song.voteCount : null,
    status: song ? song.status : null,
    timestamp: new Date().toISOString(),
  });
  if (result.autoRejected) {
    toEventRoom(io, eventId).emit('song_rejected', {
      songId,
      title: song.title,
      artist: song.artist,
      status: song.status,
      reason: song.removalReason || 'Rejected by downvotes',
      timestamp: new Date().toISOString(),
    });
  }
  await emitQueueUpdated(io, eventId);
};

const handleVoteRemoved = (socket, io, data) => {
  const { eventId, songId, participantId } = data;

  if (!eventId || !songId || !participantId) {
    socket.emit('error', { message: 'Invalid vote data' });
    return;
  }

  logger.info(`Vote removed: song ${songId}`);

  toEventRoom(io, eventId).emit('vote_removed', {
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

  toEventRoom(io, eventId).emit('song_suggested', {
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

  try {
    const { SongModel } = require('../models/schema');
    const song = await SongModel.findById(songId).select(
      'title artist status eventId',
    );

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
    toEventRoom(io, eventId).emit('song_approved', {
      songId,
      title: song.title,
      artist: song.artist,
      status: song.status,
      timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
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
    toEventRoom(io, eventId).emit('song_rejected', {
      songId,
      reason,
      timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
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
    toEventRoom(io, eventId).emit('song_skipped', {
      songId,
      reason,
      timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
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

  toEventRoom(io, eventId).emit('queue_updated', {
    eventId,
    queue,
    timestamp: new Date().toISOString(),
  });
};

/* ============ PARTICIPANTS ============ */

const handleParticipantCooldown = async (socket, io, data) => {
  const { eventId, participantId, reason } = data;

  if (!eventId || !participantId) {
    logger.error(
      `Invalid participant data - eventId: ${eventId}, participantId: ${participantId}`,
    );
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
    toEventRoom(io, eventId).emit('participant_cooldown', {
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
    logger.error(
      `Invalid participant data - eventId: ${eventId}, participantId: ${participantId}`,
    );
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
    toEventRoom(io, eventId).emit('participant_kicked', {
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

const handleParticipantBanned = async (socket, io, data) => {
  const { eventId, participantId, reason } = data;

  if (!eventId || !participantId) {
    logger.error(
      `Invalid participant data - eventId: ${eventId}, participantId: ${participantId}`,
    );
    socket.emit('error', {
      message: 'Invalid participant data',
    });
    return;
  }

  try {
    logger.info(`Participant banned: ${participantId}`, {
      eventId,
      participantId,
      action: 'PARTICIPANT_BANNED',
      reason,
    });

    toEventRoom(io, eventId).emit('participant_banned', {
      participantId,
      reason,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in participant_banned:', error);
    socket.emit('error', {
      message: error.message || 'Error banning participant',
    });
  }
};

const handleSongNowPlaying = async (socket, io, data) => {
  const {
    eventId,
    songId,
    title,
    artist,
    totalDuration,
    duration,
    recognitionMatch,
  } = data;

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
    toEventRoom(io, eventId).emit('song_now_playing', {
      songId,
      title,
      artist,
      recognitionMatch: recognitionMatch || null,
      totalDuration: totalDuration ?? duration,
      duration: totalDuration ?? duration,
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
    const {
      eventId,
      participantId,
      title,
      artist,
      totalDuration,
      duration,
      userId,
    } = data;

    // Validation
    if (!eventId || !participantId || !title || !artist) {
      throw new Error(
        'Missing required fields: eventId, participantId, title, artist',
      );
    }

    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId, participantId);

    // Call service (same as REST would)
    const song = await songsService.suggestSong(
      eventId,
      participantId,
      title,
      artist,
      totalDuration ?? duration,
      eventActor(socket, userId),
    );

    // Broadcast to room
    toEventRoom(io, eventId).emit('song_suggested', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      requestedBy: song.requestedBy,
      status: song.status,
      totalDuration: song.totalDuration,
      duration: song.duration,
      timestamp: new Date().toISOString(),
    });

    logger.info('Song suggested via Socket.IO', { songId: song._id, eventId });

    // Acknowledge to sender with result
    ackSuccess(callback, song);
  } catch (error) {
    logger.error('Error suggesting song via Socket.IO:', error);
    ackError(callback, error);
  }
};

/**
 * Handle approve_song event - PRIMARY entry point
 */
const handleApproveSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, userId } = data;
    const actor = eventActor(socket, userId);

    if (!eventId || !songId || !actor) {
      throw new Error('Missing required fields: eventId, songId');
    }

    if (!isValidId(eventId) || !isValidId(songId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId);

    const song = await songsService.approveSong(songId, eventId, actor);

    toEventRoom(io, eventId).emit('song_approved', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      recognitionMatch: song.recognitionMatch || null,
      status: song.status,
      totalDuration: song.totalDuration,
      duration: song.duration,
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

/**
 * Handle reject_song event - PRIMARY entry point
 */
const handleRejectSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, reason, userId } = data;
    const actor = eventActor(socket, userId);

    if (!eventId || !songId || !actor) {
      throw new Error('Missing required fields: eventId, songId');
    }

    if (!isValidId(eventId) || !isValidId(songId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId);

    const song = await songsService.rejectSong(songId, eventId, reason, actor);

    toEventRoom(io, eventId).emit('song_rejected', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      status: song.status,
      reason,
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

/**
 * Handle skip_song event - PRIMARY entry point
 */
const handleSkipSong = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, reason, userId } = data;
    const actor = eventActor(socket, userId);

    if (!eventId || !songId || !actor) {
      throw new Error('Missing required fields: eventId, songId');
    }

    if (!isValidId(eventId) || !isValidId(songId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId);

    const song = await songsService.skipSong(songId, eventId, reason, actor);

    toEventRoom(io, eventId).emit('song_skipped', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      status: song.status,
      reason,
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

/**
 * Handle send_now event - PRIMARY entry point
 */
const handleSendNow = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, userId } = data;
    const actor = eventActor(socket, userId);

    if (!eventId || !songId || !actor) {
      throw new Error('Missing required fields: eventId, songId');
    }

    if (!isValidId(eventId) || !isValidId(songId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId);

    const song = await songsService.sendNow(songId, eventId, actor);

    toEventRoom(io, eventId).emit('song_now_playing', {
      songId: song._id,
      title: song.title,
      artist: song.artist,
      recognitionMatch: song.recognitionMatch || null,
      status: song.status,
      totalDuration: song.totalDuration || 0,
      duration: song.duration || 0,
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

/**
 * Handle cast_vote event - PRIMARY entry point
 */
const handleCastVote = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, participantId, value, userId } = data;

    if (!eventId || !songId || !participantId) {
      throw new Error(
        'Missing required fields: eventId, songId, participantId, value',
      );
    }

    if (
      !isValidId(eventId) ||
      !isValidId(songId) ||
      !isValidId(participantId)
    ) {
      throw new Error('Invalid ID format');
    }

    if (!isValidVoteValue(value)) {
      throw new Error('Vote value must be 1 or -1');
    }

    await assertJoinedEvent(socket, eventId, participantId);

    const result = await votesService.castVote(
      songId,
      participantId,
      value,
      eventActor(socket, userId),
    );
    const vote = result.vote;
    const song = result.song;

    toEventRoom(io, eventId).emit('votes_updated', {
      songId,
      participantId,
      value,
      voteScore: song?.voteScore,
      voteCount: song?.voteCount,
      status: song?.status,
      timestamp: new Date().toISOString(),
    });
    if (result.autoRejected) {
      toEventRoom(io, eventId).emit('song_rejected', {
        songId,
        title: song.title,
        artist: song.artist,
        status: song.status,
        reason: song.removalReason || 'Rejected by downvotes',
        timestamp: new Date().toISOString(),
      });
    }
    await emitQueueUpdated(io, eventId);

    logger.info('Vote cast via Socket.IO', { songId, participantId, value });
    ackSuccess(callback, vote);
  } catch (error) {
    logger.error('Error casting vote via Socket.IO:', error);
    ackError(callback, error);
  }
};

/**
 * Handle remove_vote event - PRIMARY entry point
 */
const handleRemoveVote = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, participantId, userId } = data;

    if (!eventId || !songId || !participantId) {
      throw new Error(
        'Missing required fields: eventId, songId, participantId',
      );
    }

    if (
      !isValidId(eventId) ||
      !isValidId(songId) ||
      !isValidId(participantId)
    ) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId, participantId);

    const vote = await votesService.removeVote(
      songId,
      participantId,
      eventActor(socket, userId),
    );

    toEventRoom(io, eventId).emit('vote_removed', {
      songId,
      participantId,
      timestamp: new Date().toISOString(),
    });

    logger.info('Vote removed via Socket.IO', { songId, participantId });
    ackSuccess(callback, vote);
  } catch (error) {
    logger.error('Error removing vote via Socket.IO:', error);
    ackError(callback, error);
  }
};

/**
 * Handle set_cooldown event - PRIMARY entry point
 */
const handleSetCooldown = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, durationMs, reason, userId } = data;
    const actor = eventActor(socket, userId);

    if (!eventId || !participantId || !durationMs || !actor) {
      throw new Error(
        'Missing required fields: eventId, participantId, durationMs',
      );
    }

    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId);

    const result = await participantsService.setParticipantCooldown(
      participantId,
      durationMs,
      reason || 'Administrative action',
      actor,
    );

    toEventRoom(io, eventId).emit('participant_cooldown', {
      participantId,
      reason: reason || 'Administrative action',
      cooldownUntil:
        result.participant.cooldownUntil instanceof Date
          ? result.participant.cooldownUntil.toISOString()
          : result.participant.cooldownUntil,
      timestamp: new Date().toISOString(),
    });

    logger.info('Cooldown set via Socket.IO', {
      participantId,
      eventId,
      durationMs,
    });
    ackSuccess(callback, result.participant);
  } catch (error) {
    logger.error('Error setting cooldown via Socket.IO:', error);
    ackError(callback, error);
  }
};

/**
 * Handle kick_participant event - PRIMARY entry point
 */
const handleKickParticipant = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, reason, userId } = data;
    const actor = eventActor(socket, userId);

    if (!eventId || !participantId || !actor) {
      throw new Error('Missing required fields: eventId, participantId');
    }

    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId);

    const result = await participantsService.kickParticipant(
      participantId,
      reason || 'No reason provided',
      actor,
    );

    toEventRoom(io, eventId).emit('participant_kicked', {
      participantId,
      reason: reason || 'No reason provided',
      kickedAt:
        result.participant.leftAt instanceof Date
          ? result.participant.leftAt.toISOString()
          : result.participant.leftAt,
      timestamp: new Date().toISOString(),
    });

    logger.info('Participant kicked via Socket.IO', { participantId, eventId });
    ackSuccess(callback, result.participant);
  } catch (error) {
    logger.error('Error kicking participant via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleBanParticipant = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, reason, userId } = data;
    const actor = eventActor(socket, userId);

    if (!eventId || !participantId || !actor) {
      throw new Error('Missing required fields: eventId, participantId');
    }

    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    await assertJoinedEvent(socket, eventId);

    const result = await participantsService.banParticipant(
      participantId,
      reason || 'No reason provided',
      actor,
    );

    toEventRoom(io, eventId).emit('participant_banned', {
      participantId,
      reason: reason || 'No reason provided',
      bannedAt:
        result.participant.leftAt instanceof Date
          ? result.participant.leftAt.toISOString()
          : result.participant.leftAt,
      timestamp: new Date().toISOString(),
    });

    logger.info('Participant banned via Socket.IO', { participantId, eventId });
    ackSuccess(callback, result.participant);
  } catch (error) {
    logger.error('Error banning participant via Socket.IO:', error);
    ackError(callback, error);
  }
};

/**
 * Handle set_premium event - PRIMARY entry point
 */
const handleSetPremium = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, isPremium, userId } = data;
    const actor = eventActor(socket, userId);

    if (!participantId || typeof isPremium !== 'boolean' || !actor) {
      throw new Error('Missing required fields: participantId, isPremium');
    }

    if (!isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }

    if (eventId) {
      if (!isValidId(eventId)) {
        throw new Error('Invalid ID format');
      }
      await assertJoinedEvent(socket, eventId);
    }

    const participant = await participantsService.setPremium(
      participantId,
      isPremium,
      actor,
    );

    const broadcastEventId = participant.eventId?.toString() || '';

    if (broadcastEventId) {
      toEventRoom(io, broadcastEventId).emit('participant_premium_updated', {
        participantId,
        isPremium,
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('Premium status set via Socket.IO', {
      participantId,
      isPremium,
    });
    ackSuccess(callback, participant);
  } catch (error) {
    logger.error('Error setting premium via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleAudioMatchStart = async (socket, io, data, callback) => {
  try {
    const { eventId, sampleRate } = data || {};

    // Log the incoming sample rate from phone
    logger.info('Audio match start', { eventId, sampleRate: sampleRate ?? 'not provided' });

    await assertAudioEventAccess(socket, eventId);

    // Preload fingerprints into RAM for this event
    await sharedRamMatcher.loadEvent(eventId);

    socket.audioMatch = {
      eventId,
      fingerprinter: new StreamingFingerprinter(TARGET_SAMPLE_RATE),
      ramMatcher: sharedRamMatcher,
      inputSampleRate: sampleRate,  // Store the sample rate from phone
      lastEmitAt: 0,
    };
    ackSuccess(callback, { eventId });
  } catch (error) {
    logger.error('Error starting audio matcher:', error);
    ackError(callback, error);
  }
};

const handleAudioMatchChunk = async (socket, io, data, callback) => {
  try {
    if (!socket.audioMatch) throw new Error('Audio matcher has not started');

    const session = socket.audioMatch;

    // Extract Float32 PCM from payload.
    const rawSamples = extractFloat32Pcm(data?.pcm ?? data);

    // Prefer per-chunk sampleRate. Fall back to session sampleRate.
    const chunkSampleRate = data?.sampleRate;
    const inputSampleRate = Number.isFinite(chunkSampleRate) && chunkSampleRate > 0
      ? chunkSampleRate
      : (session.inputSampleRate || TARGET_SAMPLE_RATE);

    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
      throw new Error(
        `Invalid audio chunk sampleRate: ${data?.sampleRate ?? session.inputSampleRate}`
      );
    }
    // Normalize browser/phone audio to the recognition sample rate.
    const samples = resampleLinear(
      rawSamples,
      inputSampleRate,
      TARGET_SAMPLE_RATE,
    );

    const hashes = session.fingerprinter.process(samples) ?? [];

    const now = Date.now();

    if (hashes.length && now - session.lastEmitAt > 700) {
      session.lastEmitAt = now;

      // Use RAM-based matcher (in-memory lookup, no MongoDB query)
      const matches = session.ramMatcher.match(session.eventId, hashes);

      socket.emit('audio_match_update', {
        eventId: session.eventId,
        matches,
        timestamp: new Date().toISOString(),
      });
    }

    ackSuccess(callback, {
      hashes: hashes.length,
      inputSamples: rawSamples.length,
      normalizedSamples: samples.length,
      inputSampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
    });
  } catch (error) {
    logger.error('Error matching audio chunk:', {
      message: error.message,
      stack: error.stack,
      dataType: data?.constructor?.name,
      pcmType: data?.pcm?.constructor?.name,
      isBuffer: Buffer.isBuffer(data?.pcm ?? data),
      byteLength: data?.pcm?.byteLength ?? data?.byteLength,
      length: data?.pcm?.length ?? data?.length,
    });

    ackError(callback, error);
  }
};

const handleAudioMatchStop = async (socket, io, data, callback) => {
  try {
    if (socket.audioMatch) {
      const { eventId, fingerprinter, ramMatcher } = socket.audioMatch;
      const hashes = fingerprinter.flush();
      // Use RAM-based matcher for final matching
      const matches = ramMatcher.match(eventId, hashes);
      socket.emit('audio_match_update', {
        eventId,
        matches,
        timestamp: new Date().toISOString(),
      });
    }
    socket.audioMatch = null;
    ackSuccess(callback, { stopped: true });
  } catch (error) {
    logger.error('Error stopping audio matcher:', error);
    ackError(callback, error);
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
  handleParticipantBanned,
  handleSongNowPlaying,
  handleSuggestSong,
  handleApproveSong,
  handleRejectSong,
  handleSkipSong,
  handleSendNow,
  handleCastVote,
  handleRemoveVote,
  handleSetCooldown,
  handleKickParticipant,
  handleBanParticipant,
  handleSetPremium,
  handleAudioMatchStart,
  handleAudioMatchChunk,
  handleAudioMatchStop,
  rejectLegacyCommand,
};
