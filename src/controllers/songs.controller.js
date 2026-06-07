const { participantsService, songsService } = require('../services');
const { logger } = require('../utils');
const { httpStatus } = require('../constants');
const { songsSchema } = require('../schemas');

let io = null;

const roomForEvent = (eventId) => `event:${eventId}`;

function getSongId(song) {
  return song?._id || song?.id;
}

class SongsController {
  setIO(socketIO) {
    io = socketIO;
  }

  getIO() {
    return io;
  }

  emitSongEvent(eventId, eventName, payload) {
    if (!io || !eventId) return;
    io.to(roomForEvent(eventId)).emit(eventName, {
      eventId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  async emitQueueUpdated(eventId) {
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

  async suggestSong(req, res, next) {
    try {
      const { eventId } = req.params;
      const data = songsSchema.parseSuggestSong(req.body);

      const song = await songsService.suggestSong(
        eventId,
        data.participantId,
        data.title,
        data.artist,
        data.totalDuration,
        req.user,
        {
          musicBrainzConfirmed: data.musicBrainzConfirmed,
          musicBrainzMatch: data.musicBrainzMatch,
          skipMusicBrainzLookup: data.skipMusicBrainzLookup,
        },
      );
      let participant = null;
      try {
        participant = await participantsService.getParticipant(data.participantId);
      } catch {
        participant = null;
      }

      this.emitSongEvent(eventId, 'song_suggested', {
        songId: getSongId(song),
        title: song.title,
        artist: song.artist,
        participantId: data.participantId,
        nickname: participant?.nickname,
        requestedBy: participant || song.requestedBy,
        recognitionMatch: song.recognitionMatch || null,
        status: song.status,
        totalDuration: song.totalDuration,
        duration: song.duration,
      });

      res.status(httpStatus.CREATED).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Suggest song error:', error);
      next(error);
    }
  }

  async lookupMusicBrainz(req, res, next) {
    try {
      const { eventId } = req.params;
      const data = songsSchema.parseSuggestSong(req.body);
      const match = await songsService.lookupMusicBrainz(
        eventId,
        data.participantId,
        data.title,
        data.artist,
        data.totalDuration,
        req.user,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { match },
      });
    } catch (error) {
      logger.error('MusicBrainz lookup error:', error);
      next(error);
    }
  }

  async getMusicBrainzMatchCandidates(req, res, next) {
    try {
      const { eventId, songId } = req.params;
      const data = await songsService.getMusicBrainzMatchCandidates(eventId, songId, req.user);

      res.status(httpStatus.OK).json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('MusicBrainz match candidates error:', error);
      next(error);
    }
  }

  async assignMusicBrainzMetadataToTrack(req, res, next) {
    try {
      const { eventId, songId } = req.params;
      const { trackId } = req.body || {};
      const data = await songsService.assignMusicBrainzMetadataToTrack(
        eventId,
        songId,
        trackId,
        req.user,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Assign MusicBrainz metadata error:', error);
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
        req.user,
      );

      this.emitSongEvent(eventId, 'song_approved', {
        songId: getSongId(song),
        title: song.title,
        artist: song.artist,
        requestedBy: song.requestedBy,
        recognitionMatch: song.recognitionMatch || null,
        status: song.status,
        voteScore: song.voteScore,
        voteCount: song.voteCount,
        totalDuration: song.totalDuration,
        duration: song.duration,
      });
      await this.emitQueueUpdated(eventId);

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
        req.user,
      );

      this.emitSongEvent(eventId, 'song_rejected', {
        songId: getSongId(song),
        title: song.title,
        artist: song.artist,
        recognitionMatch: song.recognitionMatch || null,
        status: song.status,
        reason,
      });
      await this.emitQueueUpdated(eventId);

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
        req.user,
      );

      this.emitSongEvent(eventId, 'song_skipped', {
        songId: getSongId(song),
        title: song.title,
        artist: song.artist,
        status: song.status,
        reason,
      });
      await this.emitQueueUpdated(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Skip song error:', error);
      next(error);
    }
  }

  async sendNow(req, res, next) {
    try {
      const { eventId, songId } = req.params;

      const song = await songsService.sendNow(
        songId,
        eventId,
        req.user,
      );

      this.emitSongEvent(eventId, 'song_now_playing', {
        songId: getSongId(song),
        title: song.title,
        artist: song.artist,
        recognitionMatch: song.recognitionMatch || null,
        status: song.status,
        totalDuration: song.totalDuration || 0,
        duration: song.duration || 0,
        playingStartedAt: song.playingStartedAt || song.startedPlayingAt,
      });
      await this.emitQueueUpdated(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Send now song error:', error);
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

  async playNext(req, res, next) {
    try {
      const { eventId } = req.params;

      const song = await songsService.playNextSong(eventId, req.user);

      if (!song) {
        return res.status(httpStatus.NOT_FOUND).json({
          success: false,
          error: 'No approved songs in queue',
        });
      }

      this.emitSongEvent(eventId, 'song_now_playing', {
        songId: getSongId(song),
        title: song.title,
        artist: song.artist,
        recognitionMatch: song.recognitionMatch || null,
        status: song.status,
        totalDuration: song.totalDuration || 0,
        duration: song.duration || 0,
        playingStartedAt: song.playingStartedAt || song.startedPlayingAt,
      });
      await this.emitQueueUpdated(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error('Play next song error:', error);
      next(error);
    }
  }
}

module.exports = new SongsController();
