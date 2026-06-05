// Participant admin handlers: cooldown, kick, ban, setPremium.

const { logger } = require('../utils');
const { ackSuccess, ackError } = require('./ack');
const { participantsService } = require('../services');
const { assertJoinedEvent, eventActor } = require('./room');
const { toEventRoom } = require('./rooms');
const { isValidId } = require('./shared-validators');

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

module.exports = {
  handleSetCooldown,
  handleKickParticipant,
  handleBanParticipant,
  handleSetPremium,
};
