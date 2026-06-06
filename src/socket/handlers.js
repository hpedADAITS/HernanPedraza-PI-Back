const { logger } = require('../utils');
const room = require('./room');
const song = require('./song');
const vote = require('./vote');
const participant = require('./participant');
const audio = require('./audio');

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
  ['suggest_song', song.handleSuggestSong],
  ['approve_song', song.handleApproveSong],
  ['reject_song', song.handleRejectSong],
  ['skip_song', song.handleSkipSong],
  ['send_now', song.handleSendNow],
  ['cast_vote', vote.handleCastVote],
  ['remove_vote', vote.handleRemoveVote],
  ['set_cooldown', participant.handleSetCooldown],
  ['kick_participant', participant.handleKickParticipant],
  ['ban_participant', participant.handleBanParticipant],
  ['set_premium', participant.handleSetPremium],
  ['audio_match_start', audio.handleAudioMatchStart],
  ['audio_match_chunk', audio.handleAudioMatchChunk],
  ['audio_match_stop', audio.handleAudioMatchStop],
];

const handleSocketEvents = (socket, io) => {
  logger.debug('Setting up socket handlers', { socketId: socket.id });

  socket.on('join_event', async (data) => {
    logger.debug('Received join_event', { socketId: socket.id });
    try {
      await room.handleJoinEvent(socket, io, data);
    } catch (error) {
      logger.error('Error in join_event:', error);
      emitSocketError(socket, 'Error joining event');
    }
  });

  onSocketEvent(
    socket,
    'leave_event',
    (data) => room.handleLeaveEvent(socket, io, data),
    'Error leaving event',
  );

  onSocketEvent(socket, 'disconnect', () => room.handleDisconnect(socket, io));

  legacyEvents.forEach(([eventName, errorMessage]) => {
    onSocketEvent(
      socket,
      eventName,
      () => song.rejectLegacyCommand(socket, eventName),
      errorMessage,
    );
  });

  ackEvents.forEach(([eventName, handler]) => {
    onAckEvent(socket, eventName, (data, callback) => handler(socket, io, data, callback));
  });
};

module.exports = handleSocketEvents;
