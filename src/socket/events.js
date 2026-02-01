const { logger } = require("../utils");

/**
 * Manejar usuario uniéndose a un evento
 * @param {Socket} socket - Instancia de socket de Socket.IO
 * @param {Server} io - Instancia de servidor de Socket.IO
 * @param {Object} data - Datos del evento (eventCode, participantId, etc)
 */

const handleJoinEvent = (socket, io, data) => {
  const { eventCode, participantId } = data;

  if (!eventCode || !participantId) {
    socket.emit("error", {
      message: "Código de evento o ID de participante inválido",
    });
    return;
  }

  // Unirse a la sala socket.io para este evento
  socket.join(`event:${eventCode}`);

  logger.info(`Participante ${participantId} se unió al evento ${eventCode}`);

  // Notificar a otros participantes
  io.to(`event:${eventCode}`).emit("participant_joined", {
    participantId,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Manejar usuario abandonando un evento
 * @param {Socket} socket - Instancia de socket de Socket.IO
 * @param {Server} io - Instancia de servidor de Socket.IO
 * @param {Object} data - Datos del evento
 */

const handleLeaveEvent = (socket, io, data) => {
  const { eventCode, participantId } = data;

  if (!eventCode || !participantId) {
    socket.emit("error", {
      message: "Código de evento o ID de participante inválido",
    });
    return;
  }

  // Abandonar la sala
  socket.leave(`event:${eventCode}`);

  logger.info(`Participante ${participantId} abandonó el evento ${eventCode}`);

  // Notificar a otros participantes
  io.to(`event:${eventCode}`).emit("participant_left", {
    participantId,
    timestamp: new Date().toISOString(),
  });
};


const handleDisconnect = (socket, io) => {
  logger.info(`Socket ${socket.id} desconectado`);
};

module.exports = {
  handleJoinEvent,
  handleLeaveEvent,
  handleDisconnect,
};
