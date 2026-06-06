// Re-export shim. `handlers.js` imports from `./events` for backward compat.
const room = require('./room');
const song = require('./song');
const vote = require('./vote');
const participant = require('./participant');
const audio = require('./audio');

module.exports = {
  handleJoinEvent: room.handleJoinEvent,
  handleLeaveEvent: room.handleLeaveEvent,
  handleDisconnect: room.handleDisconnect,
  handleSuggestSong: song.handleSuggestSong,
  handleApproveSong: song.handleApproveSong,
  handleRejectSong: song.handleRejectSong,
  handleSkipSong: song.handleSkipSong,
  handleSendNow: song.handleSendNow,
  handleCastVote: vote.handleCastVote,
  handleRemoveVote: vote.handleRemoveVote,
  handleSetCooldown: participant.handleSetCooldown,
  handleKickParticipant: participant.handleKickParticipant,
  handleBanParticipant: participant.handleBanParticipant,
  handleSetPremium: participant.handleSetPremium,
  handleAudioMatchStart: audio.handleAudioMatchStart,
  handleAudioMatchChunk: audio.handleAudioMatchChunk,
  handleAudioMatchStop: audio.handleAudioMatchStop,
  rejectLegacyCommand: song.rejectLegacyCommand,
};
