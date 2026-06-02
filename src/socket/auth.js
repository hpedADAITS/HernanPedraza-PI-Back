const { EventModel, EventMemberModel, ParticipantModel } = require('../models/schema');

const isValidId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

const isAuthBypassed = () =>
  process.env.SOCKET_AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production';

const isSocketAuthOptional = () => isAuthBypassed();

const socketUserId = (socket) =>
  socket.user?.userId?.toString() || socket.user?._id?.toString() || socket.user?.id?.toString();

const socketActor = (socket, fallbackUserId) => {
  if (socket.user) return socket.user;
  if (isAuthBypassed() && fallbackUserId) return fallbackUserId;
  return null;
};

const requireSocketUser = (socket) => {
  const userId = socketUserId(socket);
  if (!userId && !isSocketAuthOptional(socket)) {
    throw new Error('Socket authentication is required');
  }
  return userId;
};

const findAuthorizedParticipant = async (participantId, eventId, userId) => {
  const participant = await ParticipantModel.findOne({
    _id: participantId,
    eventId,
    leftAt: null,
    isBanned: { $ne: true },
  })
    .select('eventId nickname profilePicture userId')
    .lean();

  if (!participant) return null;
  if (!participant.userId || participant.userId.toString() !== userId) return null;
  return participant;
};

const isEventMemberOrOwner = async (eventId, socket) => {
  const userId = socketUserId(socket);
  if (!userId) return false;
  if (socket.user?.role === 'ADMIN') return true;

  const event = await EventModel.findById(eventId).select('ownerId').lean();
  if (!event) {
    throw new Error('Event not found');
  }

  if (event.ownerId?.toString() === userId) return true;

  const membership = await EventMemberModel.exists({ eventId, userId });
  return Boolean(membership);
};

const assertEventRoomAccess = async (socket, eventId, participantId) => {
  if (!isValidId(eventId)) {
    throw new Error('Invalid event ID');
  }

  if (isSocketAuthOptional(socket) && !socket.user) {
    if (!participantId) {
      throw new Error('Participant access is required');
    }
    return null;
  }

  const userId = requireSocketUser(socket);
  if (await isEventMemberOrOwner(eventId, socket)) return null;

  if (!participantId || !isValidId(participantId)) {
    throw new Error('Participant access is required');
  }

  const participant = await findAuthorizedParticipant(participantId, eventId, userId);
  if (!participant) {
    throw new Error('You cannot join this event as that participant');
  }
  return participant;
};

module.exports = {
  assertEventRoomAccess,
  isSocketAuthOptional,
  socketActor,
  socketUserId,
};
