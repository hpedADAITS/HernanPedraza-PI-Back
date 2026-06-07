const { logger } = require('../utils');
const events = require('./events');

const noop = () => {};

const emitSocketError = (socket, message) => {
  socket.emit('error', { message });
};

const onSocketEvent = (socket, eventName, handler, errorMessage) => {
  socket.on(eventName, async (data) => {
    try {
      await handler(data);
    } catch (error) {
      logger.error(`Error in ${eventName}:`, error);
      if (errorMessage) emitSocketError(socket, errorMessage);
    }
  });
};

const onAckEvent = (socket, eventName, handler) => {
  socket.on(eventName, async (data, callback) => {
    try {
      await handler(data, callback || noop);
    } catch (error) {
      logger.error(`Error in ${eventName}:`, error);
      if (callback) callback({ success: false, error: error.message });
    }
  });
};

const legacyEvents = [
  ['vote_cast', 'Error casting vote'],
  ['vote_removed', 'Error removing vote'],
  ['song_suggested', 'Error suggesting song'],
  ['song_approved', 'Error approving song'],
  ['song_rejected', 'Error rejecting song'],
  ['song_skipped', 'Error skipping song'],
  ['queue_updated', 'Error updating queue'],
  ['participant_cooldown', 'Error setting cooldown'],
  ['participant_kicked', 'Error kicking participant'],
  ['participant_banned', 'Error banning participant'],
  ['song_now_playing', 'Error setting song as playing'],
];

const ackEvents = [
  ['suggest_song', events.handleSuggestSong],
  ['approve_song', events.handleApproveSong],
  ['reject_song', events.handleRejectSong],
  ['skip_song', events.handleSkipSong],
  ['send_now', events.handleSendNow],
  ['cast_vote', events.handleCastVote],
  ['remove_vote', events.handleRemoveVote],
  ['set_cooldown', events.handleSetCooldown],
  ['clear_cooldown', events.handleClearCooldown],
  ['kick_participant', events.handleKickParticipant],
  ['ban_participant', events.handleBanParticipant],
  ['set_premium', events.handleSetPremium],
  ['audio_match_start', events.handleAudioMatchStart],
  ['audio_match_chunk', events.handleAudioMatchChunk],
  ['audio_match_stop', events.handleAudioMatchStop],
];

/**
 * Handle all socket events
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
const handleSocketEvents = (socket, io) => {
  logger.debug('Setting up socket handlers', { socketId: socket.id });

  socket.on('join_event', async (data) => {
    logger.debug('Received join_event', { socketId: socket.id });
    try {
      await events.handleJoinEvent(socket, io, data);
    } catch (error) {
      logger.error('Error in join_event:', error);
      emitSocketError(socket, 'Error joining event');
    }
  });

  onSocketEvent(
    socket,
    'leave_event',
    (data) => events.handleLeaveEvent(socket, io, data),
    'Error leaving event'
  );

  onSocketEvent(socket, 'disconnect', () => events.handleDisconnect(socket, io));

  legacyEvents.forEach(([eventName, errorMessage]) => {
    onSocketEvent(
      socket,
      eventName,
      () => events.rejectLegacyCommand(socket, eventName),
      errorMessage
    );
  });

  ackEvents.forEach(([eventName, handler]) => {
    onAckEvent(socket, eventName, (data, callback) => handler(socket, io, data, callback));
  });
};

module.exports = handleSocketEvents;
