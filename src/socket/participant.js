// Participant admin handlers: cooldown, kick, ban, setPremium.

const { logger } = require('../utils');
const { ackSuccess, ackError } = require('./ack');
const { participantsService, votesService } = require('../services');
const { assertJoinedEvent, emitQueueUpdated, eventActor } = require('./room');
const { toEventRoom } = require('./rooms');
const { isValidId } = require('./shared-validators');

const emitVoteRecompute = async (io, eventId) => {
  const result = await votesService.recomputeActiveSongsForEvent(eventId);
  for (const song of result.changedSongs || []) {
    toEventRoom(io, eventId).emit('votes_updated', {
      eventId,
      songId: song.id || song._id,
      voteScore: song.voteScore,
      downvoteCount: song.downvoteCount,
      voteCount: song.voteCount,
      status: song.status,
      timestamp: new Date().toISOString(),
    });
  }
  for (const song of result.rejectedSongs || []) {
    toEventRoom(io, eventId).emit('song_rejected', {
      eventId,
      songId: song.id || song._id,
      title: song.title,
      artist: song.artist,
      status: song.status,
      reason: song.removalReason || 'Rejected by downvotes',
      timestamp: new Date().toISOString(),
    });
  }
  if ((result.changedSongs || []).length > 0 || (result.rejectedSongs || []).length > 0) {
    await emitQueueUpdated(io, eventId);
  }
  return result;
};

const handleSetCooldown = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, durationMs, reason, userId } = data;
    const actor = eventActor(socket, userId);
    if (!eventId || !participantId || !durationMs || !actor) {
      throw new Error('Missing required fields: eventId, participantId, durationMs');
    }
    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }
    await assertJoinedEvent(socket, eventId);
    const result = await participantsService.setParticipantCooldown(
      participantId, durationMs, reason || 'Administrative action', actor,
    );
    toEventRoom(io, eventId).emit('participant_cooldown', {
      participantId, reason: reason || 'Administrative action',
      cooldownUntil: result.participant.cooldownUntil instanceof Date
        ? result.participant.cooldownUntil.toISOString()
        : result.participant.cooldownUntil,
      timestamp: new Date().toISOString(),
    });
    logger.info('Cooldown set via Socket.IO', { participantId, eventId, durationMs });
    ackSuccess(callback, result.participant);
  } catch (error) {
    logger.error('Error setting cooldown via Socket.IO:', error);
    ackError(callback, error);
  }
};

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
      participantId, reason || 'No reason provided', actor,
    );
    toEventRoom(io, eventId).emit('participant_kicked', {
      participantId, reason: reason || 'No reason provided',
      kickedAt: result.participant.leftAt instanceof Date
        ? result.participant.leftAt.toISOString()
        : result.participant.leftAt,
      timestamp: new Date().toISOString(),
    });
    await emitVoteRecompute(io, eventId);
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
      participantId, reason || 'No reason provided', actor,
    );
    toEventRoom(io, eventId).emit('participant_banned', {
      participantId, reason: reason || 'No reason provided',
      bannedAt: result.participant.leftAt instanceof Date
        ? result.participant.leftAt.toISOString()
        : result.participant.leftAt,
      timestamp: new Date().toISOString(),
    });
    await emitVoteRecompute(io, eventId);
    logger.info('Participant banned via Socket.IO', { participantId, eventId });
    ackSuccess(callback, result.participant);
  } catch (error) {
    logger.error('Error banning participant via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleSetPremium = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, isPremium, userId } = data;
    const actor = eventActor(socket, userId);
    if (!participantId || typeof isPremium !== 'boolean' || !actor) {
      throw new Error('Missing required fields: participantId, isPremium');
    }
    if (!isValidId(participantId)) throw new Error('Invalid ID format');
    if (eventId) {
      if (!isValidId(eventId)) throw new Error('Invalid ID format');
      await assertJoinedEvent(socket, eventId);
    }
    const participant = await participantsService.setPremium(participantId, isPremium, actor);
    const broadcastEventId = participant.eventId?.toString() || '';
    if (broadcastEventId) {
      toEventRoom(io, broadcastEventId).emit('participant_premium_updated', {
        participantId, isPremium, timestamp: new Date().toISOString(),
      });
    }
    logger.info('Premium status set via Socket.IO', { participantId, isPremium });
    ackSuccess(callback, participant);
  } catch (error) {
    logger.error('Error setting premium via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleClearCooldown = async (socket, io, data, callback) => {
  try {
    const { eventId, participantId, userId } = data;
    const actor = eventActor(socket, userId);
    if (!eventId || !participantId || !actor) {
      throw new Error('Missing required fields: eventId, participantId');
    }
    if (!isValidId(eventId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }
    await assertJoinedEvent(socket, eventId);
    const result = await participantsService.clearParticipantCooldown(
      participantId, actor,
    );
    toEventRoom(io, eventId).emit('participant_cooldown_cleared', {
      participantId,
      timestamp: new Date().toISOString(),
    });
    logger.info('Cooldown cleared via Socket.IO', { participantId, eventId });
    ackSuccess(callback, result.participant);
  } catch (error) {
    logger.error('Error clearing cooldown via Socket.IO:', error);
    ackError(callback, error);
  }
};

module.exports = {
  handleSetCooldown,
  handleClearCooldown,
  handleKickParticipant,
  handleBanParticipant,
  handleSetPremium,
};
