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
const {
  assertEventRoomAccess,
  isEventMemberOrOwner,
  isSocketAuthOptional,
  socketActor,
  socketUserId,
} = require('./auth');
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
  /* Track whether this socket is the DJ / event owner so the
     participant_joined broadcast, leave, and disconnect paths can skip
     announcing the owner as a regular attendee. The flag is set BEFORE
     the participant record lookup so even when the owner has no
     participant record (the normal case) we still know they are staff. */
  socket.isEventStaff = await isEventMemberOrOwner(eventId, socket);
  socket.participantId = socket.isEventStaff
    ? null
    : authorizedParticipant?._id?.toString() || participantId || null;

  let persistedParticipant = authorizedParticipant;
  /* The DJ / event owner joins the room as the owner — they are NOT a
     participant and should not be recorded in the participants
     collection. Skip the joinEvent call for them so the log line and
     the persisted state reflect their actual role, and the
     `participant_joined` broadcast below does not announce the owner
     as a regular attendee. */
  if (!persistedParticipant && !socket.isEventStaff && nickname && eventId) {
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

  if (socket.isEventStaff) {
    logger.info(`DJ joined event ${eventId}`, {
      userId: socketUserId(socket),
    });
  } else {
    logger.info(`Socket joined event ${eventId}`, {
      participantId: socket.participantId,
      userId: socketUserId(socket),
    });
  }

  let profilePicture = authorizedParticipant?.profilePicture || data.profilePicture || null;
  if (participantId && !profilePicture && !isSocketAuthOptional(socket)) {
    try {
      const participant = await participantsService.getParticipant(participantId);
      profilePicture = participant.profilePicture || null;
    } catch (error) {
      logger.warn(`Unable to load participant picture for socket join: ${participantId}`);
    }
  }

  if (participantId && !socket.isEventStaff) {
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
  /* DJ sockets do not get a participant record; do not announce their
     leave as a participant. */
  if (socket.isEventStaff) {
    logger.info(`DJ left event ${eventId}`);
    return;
  }
  logger.info(`Participant ${participantId} left event ${eventId}`);
  toEventRoom(io, eventId).emit('participant_left', {
    participantId,
    leftAt: new Date().toISOString(),
  });
};

const handleDisconnect = (socket, io) => {
  if (socket.eventId && socket.participantId && !socket.isEventStaff) {
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
  toEventRoom,
};
