// Vote state-change handlers: cast, remove, plus legacy broadcast stubs.

const { logger } = require('../utils');
const { ackSuccess, ackError } = require('./ack');
const { votesService } = require('../services');
const { assertJoinedEvent, eventActor, emitQueueUpdated, toEventRoom } = require('./room');
const { isValidId, isValidVoteValue } = require('./shared-validators');
const { requireFields } = require('./middleware');

const handleCastVote = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, participantId, value } = data;
    if (!eventId || !songId || !participantId) {
      throw new Error('Missing required fields: eventId, songId, participantId, value');
    }
    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }
    if (!isValidVoteValue(value)) {
      throw new Error('Vote value must be 1 or -1');
    }
    await assertJoinedEvent(socket, eventId, participantId);
    const result = await votesService.castVote(songId, participantId, value, eventActor(socket));
    const vote = result.vote;
    const song = result.song;
    toEventRoom(io, eventId).emit('votes_updated', {
      eventId, songId, participantId, value,
      voteScore: song?.voteScore, voteCount: song?.voteCount, status: song?.status,
      timestamp: new Date().toISOString(),
    });
    if (result.autoRejected) {
      toEventRoom(io, eventId).emit('song_rejected', {
        eventId, songId, title: song.title, artist: song.artist, status: song.status,
        reason: song.removalReason || 'Rejected by downvotes',
        timestamp: new Date().toISOString(),
      });
    }
    await emitQueueUpdated(io, eventId);
    logger.info('Vote cast via Socket.IO', { songId, participantId, value });
    ackSuccess(callback, vote);
  } catch (error) {
    logger.error('Error casting vote via Socket.IO:', error);
    ackError(callback, error);
  }
};

const handleRemoveVote = async (socket, io, data, callback) => {
  try {
    const { eventId, songId, participantId } = data;
    if (!eventId || !songId || !participantId) {
      throw new Error('Missing required fields: eventId, songId, participantId');
    }
    if (!isValidId(eventId) || !isValidId(songId) || !isValidId(participantId)) {
      throw new Error('Invalid ID format');
    }
    await assertJoinedEvent(socket, eventId, participantId);
    const result = await votesService.removeVote(songId, participantId, eventActor(socket));
    const song = result.song;
    toEventRoom(io, eventId).emit('vote_removed', {
      eventId, songId, participantId,
      voteScore: song?.voteScore, voteCount: song?.voteCount,
      timestamp: new Date().toISOString(),
    });
    toEventRoom(io, eventId).emit('votes_updated', {
      eventId, songId, participantId, value: 0,
      voteScore: song?.voteScore, voteCount: song?.voteCount, status: song?.status,
      timestamp: new Date().toISOString(),
    });
    await emitQueueUpdated(io, eventId);
    logger.info('Vote removed via Socket.IO', { songId, participantId });
    ackSuccess(callback, result);
  } catch (error) {
    logger.error('Error removing vote via Socket.IO:', error);
    ackError(callback, error);
  }
};

// Legacy broadcast-only stubs
module.exports = {
  handleCastVote,
  handleRemoveVote,
};
