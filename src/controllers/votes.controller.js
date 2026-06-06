const { songsService, votesService } = require('../services');
const { logger } = require('../utils');
const { httpStatus } = require('../constants');
const { votesSchema } = require('../schemas');

const { setIO, getIO } = require('../services/realtime.service');

const roomForEvent = (eventId) => `event:${eventId}`;

class VotesController {
  emitVoteEvent(eventId, eventName, payload) {
    const io = getIO();
    if (!io || !eventId) return;
    io.to(roomForEvent(eventId)).emit(eventName, {
      eventId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  async emitQueueUpdated(eventId) {
    const io = getIO();
    if (!io || !eventId) return;

    const snapshot = songsService.getQueueSnapshotForEvent
      ? await songsService.getQueueSnapshotForEvent(eventId)
      : { queue: await songsService.getQueueForEvent(eventId), nowPlaying: null };
    io.to(roomForEvent(eventId)).emit('queue_updated', {
      eventId,
      ...snapshot,
      timestamp: new Date().toISOString(),
    });
  }

  async castVote(req, res, next) {
    try {
      const data = votesSchema.parseCastVote(req.body);

      const result = await votesService.castVote(
        data.songId,
        data.participantId,
        data.value,
        req.user,
      );

      const vote = result.vote || result;
      const song = result.song || (await songsService.getSongStats(data.songId));
      const eventId = song.eventId?.toString();

      this.emitVoteEvent(eventId, 'votes_updated', {
        songId: data.songId,
        participantId: data.participantId,
        value: data.value,
        voteScore: song.voteScore,
        voteCount: song.voteCount,
        status: song.status,
      });
      if (result.autoRejected) {
        this.emitVoteEvent(eventId, 'song_rejected', {
          songId: data.songId,
          title: song.title,
          artist: song.artist,
          status: song.status,
          reason: song.removalReason || 'Rejected by downvotes',
        });
      }
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

      await votesService.removeVote(songId, participantId, req.user);

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
