// Re-export shim. The 1,371-line god file was split into:
//   - room.js          — join/leave/disconnect + shared helpers
//   - song.js          — suggest/approve/reject/skip/sendNow + legacy stubs
//   - vote.js          — cast/remove + legacy stubs
//   - participant.js   — set_cooldown/kick/ban/set_premium
//   - audio.js         — audio_match_start/chunk/stop + extractFloat32Pcm
//   - shared-validators.js — isValidId / isValidVoteValue
//
// `handlers.js` continues to import from `./events` for backward compat.

const room = require('./room');
const song = require('./song');
const vote = require('./vote');
const participant = require('./participant');
const audio = require('./audio');

module.exports = {
  // room
  handleJoinEvent: room.handleJoinEvent,
  handleLeaveEvent: room.handleLeaveEvent,
  handleDisconnect: room.handleDisconnect,
  // song
  handleSuggestSong: song.handleSuggestSong,
  handleApproveSong: song.handleApproveSong,
  handleRejectSong: song.handleRejectSong,
  handleSkipSong: song.handleSkipSong,
  handleSendNow: song.handleSendNow,
  handleSongSuggested: song.handleSongSuggested,
  handleSongApproved: song.handleSongApproved,
  handleSongRejected: song.handleSongRejected,
  handleSongSkipped: song.handleSongSkipped,
  handleSongNowPlaying: song.handleSongNowPlaying,
  handleQueueUpdated: song.handleQueueUpdated,
  // vote
  handleCastVote: vote.handleCastVote,
  handleRemoveVote: vote.handleRemoveVote,
  handleVotesCast: vote.handleVotesCast,
  handleVoteRemoved: vote.handleVoteRemoved,
  // participant
  handleSetCooldown: participant.handleSetCooldown,
  handleKickParticipant: participant.handleKickParticipant,
  handleBanParticipant: participant.handleBanParticipant,
  handleSetPremium: participant.handleSetPremium,
  // audio
  handleAudioMatchStart: audio.handleAudioMatchStart,
  handleAudioMatchChunk: audio.handleAudioMatchChunk,
  handleAudioMatchStop: audio.handleAudioMatchStop,
  // legacy rejector
  rejectLegacyCommand: song.rejectLegacyCommand,
};
