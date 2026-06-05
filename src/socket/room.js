// Room lifecycle: join, leave, disconnect.
// Also the helper for asserting a socket is in a room before a domain action
// runs (`assertJoinedEvent`) and the helper for emitting queue updates to
// every member of an event room.

const { logger } = require('../utils');
const { isValidId } = require('./shared-validators');
const {
  isInEventRoom,
  joinEventRoom,
  leaveEventRoom,
  toEventRoom,
} = require('./rooms');
const { assertEventRoomAccess, isSocketAuthOptional, socketActor, socketUserId } = require('./auth');
const { participantsService, songsService } = require('../services');

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

const emitQueueUpdated = async (io, eventId) => {
  const snapshot = await songsService.getQueueSnapshotForEvent(eventId);
  toEventRoom(io, eventId).emit('queue_updated', {
    eventId,
    ...snapshot,
    timestamp: new Date().toISOString(),
  });
};

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

  const authorizedParticipant = await assertEventRoomAccess(socket, eventId, participantId);
  joinEventRoom(socket, eventId);
  socket.eventId = eventId;
  socket.participantId = authorizedParticipant?._id?.toString() || participantId || null;

  let persistedParticipant = authorizedParticipant;
  if (!persistedParticipant && nickname && eventId) {
    try {
      const userId = socketUserId(socket);
      persistedParticipant = await participantsService.joinEvent(
        eventId,
        nickname,
        data.profilePicture || null,
        undefined,
        userId,
      );
      socket.participantId = persistedParticipant?._id?.toString() || participantId;
    } catch (err) {
      logger.warn('Persist socket participant:', err.message);
    }
  }

  logger.info(`Socket joined event ${eventId}`, {
    participantId: socket.participantId,
    userId: socketUserId(socket),
  });

  let profilePicture = authorizedParticipant?.profilePicture || data.profilePicture || null;
  if (participantId && !profilePicture && !isSocketAuthOptional(socket)) {
    try {
      const participant = await participantsService.getParticipant(participantId);
      profilePicture = participant.profilePicture || null;
    } catch (error) {
      logger.warn(`Unable to load participant picture for socket join: ${participantId}`);
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

module.exports = {
  handleJoinEvent,
  handleLeaveEvent,
  handleDisconnect,
  assertJoinedEvent,
  eventActor,
  rejectLegacyCommand,
  emitQueueUpdated,
  isValidId,
};
