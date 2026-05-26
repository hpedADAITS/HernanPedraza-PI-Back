const { logger } = require('../utils');
const events = require('./events');

/**
 * Handle all socket events
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
const handleSocketEvents = (socket, io) => {
  console.log(`[Socket Handler] Setting up handlers for socket ${socket.id}`);
  socket.on('join_event', async (data) => {
    console.log(`[Socket Handler] Received join_event on socket ${socket.id}`);
    try {
      await events.handleJoinEvent(socket, io, data);
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

  /* ============ VOTING ============ */
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

  /* ============ SONGS ============ */
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

  /* ============ PARTICIPANTS ============ */
  socket.on('participant_cooldown', (data) => {
    try {
      events.handleParticipantCooldown(socket, io, data);
    } catch (error) {
      logger.error('Error in participant_cooldown:', error);
      socket.emit('error', { message: 'Error setting cooldown' });
    }
  });

  socket.on('participant_kicked', (data) => {
    try {
      events.handleParticipantKicked(socket, io, data);
    } catch (error) {
      logger.error('Error in participant_kicked:', error);
      socket.emit('error', { message: 'Error kicking participant' });
    }
  });

  socket.on('participant_banned', (data) => {
    try {
      events.handleParticipantBanned(socket, io, data);
    } catch (error) {
      logger.error('Error in participant_banned:', error);
      socket.emit('error', { message: 'Error banning participant' });
    }
  });

  /* ============ SONG NOW PLAYING ============ */
  socket.on('song_now_playing', (data) => {
    try {
      events.handleSongNowPlaying(socket, io, data);
    } catch (error) {
      logger.error('Error in song_now_playing:', error);
      socket.emit('error', { message: 'Error setting song as playing' });
    }
  });

  /* ============ SOCKET.IO PRIMARY STATE CHANGES (with acknowledgment) ============ */

  /* Suggest Song - PRIMARY entry point */
  socket.on('suggest_song', (data, callback) => {
    try {
      events.handleSuggestSong(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in suggest_song:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Approve Song - PRIMARY entry point */
  socket.on('approve_song', (data, callback) => {
    try {
      events.handleApproveSong(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in approve_song:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Reject Song - PRIMARY entry point */
  socket.on('reject_song', (data, callback) => {
    try {
      events.handleRejectSong(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in reject_song:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Skip Song - PRIMARY entry point */
  socket.on('skip_song', (data, callback) => {
    try {
      events.handleSkipSong(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in skip_song:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Send Now - PRIMARY entry point */
  socket.on('send_now', (data, callback) => {
    try {
      events.handleSendNow(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in send_now:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Cast Vote - PRIMARY entry point */
  socket.on('cast_vote', (data, callback) => {
    try {
      events.handleCastVote(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in cast_vote:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Remove Vote - PRIMARY entry point */
  socket.on('remove_vote', (data, callback) => {
    try {
      events.handleRemoveVote(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in remove_vote:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Set Cooldown - PRIMARY entry point */
  socket.on('set_cooldown', (data, callback) => {
    try {
      events.handleSetCooldown(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in set_cooldown:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Kick Participant - PRIMARY entry point */
  socket.on('kick_participant', (data, callback) => {
    try {
      events.handleKickParticipant(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in kick_participant:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  /* Set Premium - PRIMARY entry point */
  socket.on('set_premium', (data, callback) => {
    try {
      events.handleSetPremium(socket, io, data, callback || (() => {}));
    } catch (error) {
      logger.error('Error in set_premium:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });
};

module.exports = handleSocketEvents;
