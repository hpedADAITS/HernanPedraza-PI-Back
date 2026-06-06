const { audioTracksService, eventsService } = require('../services');
const songsService = require('../services/songs.service');
const { EventModel, UserModel } = require('../models/schema');
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

  async sendMatchedTrackNow(req, res, next) {
    try {
      logger.info('sendMatchedTrackNow called', { eventId: req.params.eventId, trackId: req.params.trackId });
      const event = await EventModel.findById(req.params.eventId).select('ownerId').lean();
      if (!event) return next(new Error('Event not found'));
      const owner = await UserModel.findById(event.ownerId)
        .select('authTokenVersion role')
        .lean();

      const auth = req.get('authorization') || '';
      const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const token = bearerToken || req.body?.token;
      const actor = req.user
        || (await eventsService.assertPhoneMicrophoneActor(
          { _id: event._id, ownerId: event.ownerId },
          owner,
          token,
        ));

      const song = await audioTracksService.sendMatchedTrackNow(
        req.params.eventId,
        actor,
        req.params.trackId,
      );
      logger.info('sendMatchedTrackNow success', { songId: song._id, title: song.title });
      const io = req.app.get('io');
      if (io) {
        io.to(`event:${req.params.eventId}`).emit('song_now_playing', {
          songId: song._id,
          title: song.title,
          artist: song.artist,
          recognitionMatch: song.recognitionMatch || null,
          status: song.status,
          startedAt: song.startedAt || song.playingStartedAt || song.startedPlayingAt,
          totalDuration: song.totalDuration || 0,
          timestamp: new Date().toISOString(),
        });
        io.to(`event:${req.params.eventId}`).emit('queue_updated', {
          queue: await songsService.getQueueForEvent(req.params.eventId),
          timestamp: new Date().toISOString(),
        });
      }
      res.status(httpStatus.OK).json({ success: true, data: { song } });
    } catch (error) {
      logger.error('Send matched audio track now error:', error);
      next(error);
    }
  }
}

module.exports = new AudioTracksController();
