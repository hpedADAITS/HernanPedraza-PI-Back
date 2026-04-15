const { logger } = require('../utils');
const events = require('./events');

/**
 * Handle all socket events
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
const handleSocketEvents = (socket, io) => {
  console.log(`[Socket Handler] Setting up handlers for socket ${socket.id}`);
  socket.on('join_event', (data) => {
    console.log(`[Socket Handler] Received join_event on socket ${socket.id}`);
    try {
      events.handleJoinEvent(socket, io, data);
    } catch (error) {
      logger.error('Error in join_event:', error);
      socket.emit('error', { message: 'Error joining event' });
    }
  });

  socket.on('leave_event', (data) => {
    try {
      events.handleLeaveEvent(socket, io, data);
    } catch (error) {
      logger.error('Error in leave_event:', error);
      socket.emit('error', { message: 'Error leaving event' });
    }
  });

  socket.on('disconnect', () => {
    try {
      events.handleDisconnect(socket, io);
    } catch (error) {
      logger.error('Error in disconnect:', error);
    }
  });

  // ============ VOTING ============
  socket.on('vote_cast', async (data) => {
    try {
      await events.handleVotesCast(socket, io, data);
    } catch (error) {
      logger.error('Error in vote_cast:', error);
      socket.emit('error', { message: 'Error casting vote' });
    }
  });

  socket.on('vote_removed', (data) => {
    try {
      events.handleVoteRemoved(socket, io, data);
    } catch (error) {
      logger.error('Error in vote_removed:', error);
      socket.emit('error', { message: 'Error removing vote' });
    }
  });

  // ============ SONGS ============
  socket.on('song_suggested', (data) => {
    try {
      events.handleSongSuggested(socket, io, data);
    } catch (error) {
      logger.error('Error in song_suggested:', error);
      socket.emit('error', { message: 'Error suggesting song' });
    }
  });

  socket.on('song_approved', async (data) => {
    try {
      await events.handleSongApproved(socket, io, data);
    } catch (error) {
      logger.error('Error in song_approved:', error);
      socket.emit('error', { message: 'Error approving song' });
    }
  });

  socket.on('song_rejected', (data) => {
    try {
      events.handleSongRejected(socket, io, data);
    } catch (error) {
      logger.error('Error in song_rejected:', error);
      socket.emit('error', { message: 'Error rejecting song' });
    }
  });

  socket.on('song_skipped', (data) => {
    try {
      events.handleSongSkipped(socket, io, data);
    } catch (error) {
      logger.error('Error in song_skipped:', error);
      socket.emit('error', { message: 'Error skipping song' });
    }
  });

  socket.on('queue_updated', (data) => {
    try {
      events.handleQueueUpdated(socket, io, data);
    } catch (error) {
      logger.error('Error in queue_updated:', error);
      socket.emit('error', { message: 'Error updating queue' });
    }
  });
};

module.exports = handleSocketEvents;
