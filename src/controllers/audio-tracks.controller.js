const { audioTracksService } = require('../services');
const songsService = require('../services/songs.service');
const { httpStatus } = require('../constants');
const { logger } = require('../utils');
const { verifyToken } = require('../utils/jwt.utils');

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
      const token = req.body?.token || req.query?.token || req.get('authorization')?.replace(/^Bearer\s+/i, '');
      const actor = req.user || verifyPhoneMicrophoneToken(token, req.params.eventId);
      const song = await audioTracksService.sendMatchedTrackNow(
        req.params.eventId,
        actor,
        req.params.trackId,
      );
      const io = req.app.get('io');
      if (io) {
        io.to(`event:${req.params.eventId}`).emit('song_now_playing', {
          songId: song._id,
          title: song.title,
          artist: song.artist,
          recognitionMatch: song.recognitionMatch || null,
          status: song.status,
          totalDuration: song.totalDuration || 0,
          duration: song.duration || 0,
          playingStartedAt: song.playingStartedAt || song.startedPlayingAt,
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

function verifyPhoneMicrophoneToken(token, eventId) {
  const decoded = verifyToken(token || '');
  if (decoded.type !== 'phone-microphone' || decoded.eventId !== eventId) {
    throw new Error('Invalid phone microphone token');
  }
  return decoded;
}

module.exports = new AudioTracksController();
