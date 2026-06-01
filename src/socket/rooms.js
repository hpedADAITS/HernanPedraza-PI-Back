const roomForEvent = (eventId) => `event:${eventId}`;

const isInEventRoom = (socket, eventId) => socket.rooms.has(roomForEvent(eventId));

const joinEventRoom = (socket, eventId) => socket.join(roomForEvent(eventId));

const leaveEventRoom = (socket, eventId) => socket.leave(roomForEvent(eventId));

const toEventRoom = (io, eventId) => io.to(roomForEvent(eventId));

module.exports = {
  roomForEvent,
  isInEventRoom,
  joinEventRoom,
  leaveEventRoom,
  toEventRoom,
};
