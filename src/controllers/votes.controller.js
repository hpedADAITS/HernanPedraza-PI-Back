const { songsService, votesService } = require('../services');
const { logger } = require('../utils');
const { httpStatus } = require('../constants');
const { votesSchema } = require('../schemas');

let io = null;

const roomForEvent = (eventId) => `event:${eventId}`;

function buildNowPlaying(queue) {
  const playing = queue.find((song) => song.status === 'PLAYING');
  if (!playing) return null;

  const startedAt = playing.playingStartedAt || playing.startedPlayingAt;
  const elapsedTime = startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
    : 0;
  const duration = playing.duration || 0;

  return {
    songId: playing._id || playing.id,
    title: playing.title,
    artist: playing.artist,
    duration,
    playingStartedAt: startedAt,
    elapsedTime,
    remainingTime: duration ? Math.max(0, duration - elapsedTime) : 0,
  };
}

class VotesController {
  setIO(socketIO) {
    io = socketIO;
  }

  getIO() {
    return io;
  }

  emitVoteEvent(eventId, eventName, payload) {
    if (!io || !eventId) return;
    io.to(roomForEvent(eventId)).emit(eventName, {
      eventId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  async emitQueueUpdated(eventId) {
    if (!io || !eventId) return;

    const queue = await songsService.getQueueForEvent(eventId);
    io.to(roomForEvent(eventId)).emit('queue_updated', {
      eventId,
      queue,
      nowPlaying: buildNowPlaying(queue),
      timestamp: new Date().toISOString(),
    });
  }

  async castVote(req, res, next) {
    try {
      const data = votesSchema.parseCastVote(req.body);

      const vote = await votesService.castVote(
        data.songId,
        data.participantId,
        data.value,
      );

      const song = await songsService.getSongStats(data.songId);
      const eventId = song.eventId?.toString();

      this.emitVoteEvent(eventId, 'votes_updated', {
        songId: data.songId,
        participantId: data.participantId,
        value: data.value,
        voteScore: song.voteScore,
        voteCount: song.voteCount,
      });
      await this.emitQueueUpdated(eventId);

      res.status(httpStatus.CREATED).json({
        success: true,
        data: { vote },
      });
    } catch (error) {
      logger.error('Cast vote error:', error);
      next(error);
    }
  }

  async removeVote(req, res, next) {
    try {
      const { songId, participantId } = req.params;

      await votesService.removeVote(songId, participantId);

      const song = await songsService.getSongStats(songId);
      const eventId = song.eventId?.toString();

      this.emitVoteEvent(eventId, 'vote_removed', {
        songId,
        participantId,
        voteScore: song.voteScore,
        voteCount: song.voteCount,
      });
      this.emitVoteEvent(eventId, 'votes_updated', {
        songId,
        participantId,
        value: 0,
        voteScore: song.voteScore,
        voteCount: song.voteCount,
      });
      await this.emitQueueUpdated(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { message: 'Vote removed' },
      });
    } catch (error) {
      logger.error('Remove vote error:', error);
      next(error);
    }
  }

  async getVoteStats(req, res, next) {
    try {
      const { eventId } = req.params;

      const stats = await votesService.getVoteStats(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Get vote stats error:', error);
      next(error);
    }
  }

  async getParticipantVote(req, res, next) {
    try {
      const { songId, participantId } = req.params;

      const vote = await votesService.getParticipantVote(songId, participantId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { vote },
      });
    } catch (error) {
      logger.error('Get participant vote error:', error);
      next(error);
    }
  }
}

module.exports = new VotesController();
