const { audioTracksService } = require('../services');
const { httpStatus } = require('../constants');
const { logger } = require('../utils');

class AudioTracksController {
  async createTrack(req, res, next) {
    try {
      const track = await audioTracksService.createTrack(
        req.params.eventId,
        req.user,
        req.body,
        req.file,
      );
      res.status(httpStatus.CREATED).json({ success: true, data: { track } });
    } catch (error) {
      logger.error('Create audio track error:', error);
      next(error);
    }
  }

  async listTracks(req, res, next) {
    try {
      const tracks = await audioTracksService.listTracks(req.params.eventId, req.user);
      res.status(httpStatus.OK).json({ success: true, data: { tracks } });
    } catch (error) {
      logger.error('List audio tracks error:', error);
      next(error);
    }
  }

  async deleteTrack(req, res, next) {
    try {
      const track = await audioTracksService.deleteTrack(
        req.params.eventId,
        req.params.trackId,
        req.user,
      );
      res.status(httpStatus.OK).json({ success: true, data: { track } });
    } catch (error) {
      logger.error('Delete audio track error:', error);
      next(error);
    }
  }

  async matchAudio(req, res, next) {
    try {
      const matches = await audioTracksService.matchWav(
        req.params.eventId,
        req.user,
        req.file,
      );
      res.status(httpStatus.OK).json({ success: true, data: { matches } });
    } catch (error) {
      logger.error('Match audio error:', error);
      next(error);
    }
  }
}

module.exports = new AudioTracksController();
