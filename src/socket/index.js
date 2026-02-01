const handleSocketEvents = require("./handlers");

/**
 * Initialize Socket.IO handlers
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
const initializeSocket = (socket, io) => {
  handleSocketEvents(socket, io);
};

module.exports = {
  initializeSocket,
  handleSocketEvents,
};
