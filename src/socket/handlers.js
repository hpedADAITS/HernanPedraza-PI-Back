const { logger } = require("../utils");
const events = require("./events");

/**
 * Manejar todos los eventos de socket
 * @param {Socket} socket - Instancia de socket de Socket.IO
 * @param {Server} io - Instancia de servidor de Socket.IO
 */
const handleSocketEvents = (socket, io) => {
  // Unirse a evento
  socket.on("join_event", (data) => {
    try {
      events.handleJoinEvent(socket, io, data);
    } catch (error) {
      logger.error("Error en join_event:", error);
      socket.emit("error", { message: "Error al unirse al evento" });
    }
  });

  // Abandonar evento
  socket.on("leave_event", (data) => {
    try {
      events.handleLeaveEvent(socket, io, data);
    } catch (error) {
      logger.error("Error en leave_event:", error);
      socket.emit("error", { message: "Error al abandonar el evento" });
    }
  });

  // Manejar desconexión
  socket.on("disconnect", () => {
    try {
      events.handleDisconnect(socket, io);
    } catch (error) {
      logger.error("Error en desconexión:", error);
    }
  });

  // TODO: Agregar más manejadores de eventos de socket
  // - eventos de votos
  // - eventos de sugerencia de canciones
  // - eventos de cambio de estado de canción
  // - eventos de participantes
  // etc.
};

module.exports = handleSocketEvents;
