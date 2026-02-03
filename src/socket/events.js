const { logger } = require("../utils");

// ============ EVENT PARTICIPATION ============

const handleJoinEvent = (socket, io, data) => {
  const { eventId, participantId, nickname } = data;

  if (!eventId || !participantId) {
    socket.emit("error", { message: "Invalid event or participant ID" });
    return;
  }

  socket.join(`event:${eventId}`);
  socket.eventId = eventId;
  socket.participantId = participantId;

  logger.info(`Participant ${participantId} joined event ${eventId}`);

  io.to(`event:${eventId}`).emit("participant_joined", {
    participantId,
    nickname,
    joinedAt: new Date().toISOString(),
  });
};

const handleLeaveEvent = (socket, io, data) => {
  const { eventId, participantId } = data;

  if (!eventId || !participantId) {
    socket.emit("error", { message: "Invalid event or participant ID" });
    return;
  }

  socket.leave(`event:${eventId}`);

  logger.info(`Participant ${participantId} left event ${eventId}`);

  io.to(`event:${eventId}`).emit("participant_left", {
    participantId,
    leftAt: new Date().toISOString(),
  });
};

const handleDisconnect = (socket, io) => {
  if (socket.eventId && socket.participantId) {
    io.to(`event:${socket.eventId}`).emit("participant_disconnected", {
      participantId: socket.participantId,
    });
  }
  logger.info(`Socket ${socket.id} disconnected`);
};

// ============ VOTING ============

const handleVotesCast = (socket, io, data) => {
  const { eventId, songId, participantId, value } = data;

  if (!eventId || !songId || !participantId) {
    socket.emit("error", { message: "Invalid vote data" });
    return;
  }

  logger.info(`Vote cast: song ${songId}, value ${value}`);

  io.to(`event:${eventId}`).emit("votes_updated", {
    songId,
    participantId,
    value,
    timestamp: new Date().toISOString(),
  });
};

const handleVoteRemoved = (socket, io, data) => {
  const { eventId, songId, participantId } = data;

  if (!eventId || !songId || !participantId) {
    socket.emit("error", { message: "Invalid vote data" });
    return;
  }

  logger.info(`Vote removed: song ${songId}`);

  io.to(`event:${eventId}`).emit("vote_removed", {
    songId,
    participantId,
    timestamp: new Date().toISOString(),
  });
};

// ============ SONGS ============

const handleSongSuggested = (socket, io, data) => {
  const { eventId, songId, title, artist, participantId } = data;

  if (!eventId || !songId || !title || !artist) {
    socket.emit("error", { message: "Invalid song data" });
    return;
  }

  logger.info(`Song suggested: ${title} by ${artist}`);

  io.to(`event:${eventId}`).emit("song_suggested", {
    songId,
    title,
    artist,
    participantId,
    timestamp: new Date().toISOString(),
  });
};

const handleSongApproved = (socket, io, data) => {
  const { eventId, songId } = data;

  if (!eventId || !songId) {
    socket.emit("error", { message: "Invalid song data" });
    return;
  }

  logger.info(`Song approved: ${songId}`);

  io.to(`event:${eventId}`).emit("song_approved", {
    songId,
    timestamp: new Date().toISOString(),
  });
};

const handleSongRejected = (socket, io, data) => {
  const { eventId, songId, reason } = data;

  if (!eventId || !songId) {
    socket.emit("error", { message: "Invalid song data" });
    return;
  }

  logger.info(`Song rejected: ${songId}`);

  io.to(`event:${eventId}`).emit("song_rejected", {
    songId,
    reason,
    timestamp: new Date().toISOString(),
  });
};

const handleSongSkipped = (socket, io, data) => {
  const { eventId, songId, reason } = data;

  if (!eventId || !songId) {
    socket.emit("error", { message: "Invalid song data" });
    return;
  }

  logger.info(`Song skipped: ${songId}`);

  io.to(`event:${eventId}`).emit("song_skipped", {
    songId,
    reason,
    timestamp: new Date().toISOString(),
  });
};

const handleQueueUpdated = (socket, io, data) => {
  const { eventId, queue } = data;

  if (!eventId || !queue) {
    socket.emit("error", { message: "Invalid queue data" });
    return;
  }

  logger.info(`Queue updated for event ${eventId}`);

  io.to(`event:${eventId}`).emit("queue_updated", {
    queue,
    timestamp: new Date().toISOString(),
  });
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
};
