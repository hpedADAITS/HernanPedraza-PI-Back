const { songsService } = require('../services');
const { logger } = require('../utils');
const { httpStatus } = require('../constants');
const { songsValidator } = require('../validators');
const { songsDtos } = require('../dtos');

class SongsController {
  async suggestSong(req, res, next) {
    try {
      const { eventId } = req.params;
      const dto = songsDtos.toSuggestSongDTO(req.body);

      songsValidator.validateSuggestSong(dto);

      const song = await songsService.suggestSong(
        eventId,
        dto.participantId,
        dto.title,
        dto.artist,
      );

      res.status(httpStatus.CREATED).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Suggest song error:', error);
      next(error);
    }
  }

  async getQueue(req, res, next) {
    try {
      const { eventId } = req.params;

      const songs = await songsService.getQueueForEvent(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { queue: songs },
      });
    } catch (error) {
      logger.error('Get queue error:', error);
      next(error);
    }
  }

  async getPendingSongs(req, res, next) {
    try {
      const { eventId } = req.params;

      const songs = await songsService.getPendingSongsForEvent(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { pending: songs },
      });
    } catch (error) {
      logger.error('Get pending songs error:', error);
      next(error);
    }
  }

  async approveSong(req, res, next) {
    try {
      const { eventId, songId } = req.params;

      const song = await songsService.approveSong(
        songId,
        eventId,
        req.user.userId,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Approve song error:', error);
      next(error);
    }
  }

  async rejectSong(req, res, next) {
    try {
      const { eventId, songId } = req.params;
      const { reason } = req.body;

      const song = await songsService.rejectSong(
        songId,
        eventId,
        reason,
        req.user.userId,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Reject song error:', error);
      next(error);
    }
  }

  async skipSong(req, res, next) {
    try {
      const { eventId, songId } = req.params;
      const { reason } = req.body;

      const song = await songsService.skipSong(
        songId,
        eventId,
        reason,
        req.user.userId,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Skip song error:', error);
      next(error);
    }
  }

  async getSongPosition(req, res, next) {
    try {
      const { songId } = req.params;

      const data = await songsService.getSongPosition(songId);

      res.status(httpStatus.OK).json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Get song position error:', error);
      next(error);
    }
  }
}

module.exports = new SongsController();
