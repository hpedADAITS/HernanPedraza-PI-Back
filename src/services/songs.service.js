const {
  SongModel,
  EventModel,
} = require('../models/schema');
const { logger } = require('../utils');
const { NotFoundError } = require('../errors');
const { validateTransition } = require('../utils/song-state-machine');
const participantsService = require('./participants.service');

class SongsService {
  async suggestSong(eventId, participantId, title, artist, totalDuration) {
    await participantsService.ensureParticipantCanInteract(
      participantId,
      eventId,
      { checkCooldown: true },
    );

    const song = new SongModel({
      eventId,
      title,
      artist,
      requestedBy: participantId,
      status: 'PENDING',
      sortKey: `${Date.now()}_${Math.random()}`,
      totalDuration,
    });

    await song.save();
    logger.info(`Song suggested: ${title} by ${artist}`);

    return this._formatSong(song);
  }

  async getQueueForEvent(eventId) {
    const songs = await SongModel.find({
      eventId,
      status: { $in: ['APPROVED', 'PLAYING'] },
    })
      .populate('requestedBy', 'nickname profilePicture')
      .sort({ pinned: -1, voteScore: -1, sortKey: 1 });

    return this._withQueuePositions(songs);
  }

  async getQueueSnapshotForEvent(eventId) {
    const queue = await this.getQueueForEvent(eventId);
    return {
      queue,
      nowPlaying: this._buildNowPlaying(queue),
    };
  }

  async getPendingSongsForEvent(eventId) {
    const songs = await SongModel.find({
      eventId,
      status: 'PENDING',
    })
      .populate('requestedBy', 'nickname profilePicture')
      .sort({ createdAt: 1 });

    return songs.map((s) => this._formatSong(s));
  }

  async approveSong(songId, eventId, userId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    if (song.eventId.toString() !== eventId.toString()) {
      throw new NotFoundError('Song not in this event');
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'APPROVED', 'DJ');

    song.status = 'APPROVED';
    await song.save();

    logger.info(`Song approved: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_APPROVE',
    });
    return this._formatSong(song);
  }

  async rejectSong(songId, eventId, reason, userId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    if (song.eventId.toString() !== eventId.toString()) {
      throw new NotFoundError('Song not in this event');
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'REJECTED', 'DJ');

    song.status = 'REJECTED';
    await song.save();

    logger.info(`Song rejected: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_REJECT',
      reason,
    });
    return this._formatSong(song);
  }

  async sendNow(songId, eventId, userId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    if (song.eventId.toString() !== eventId.toString()) {
      throw new NotFoundError('Song not in this event');
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'PLAYING', 'DJ');

    await SongModel.updateMany(
      {
        eventId: song.eventId,
        status: 'PLAYING',
        _id: { $ne: song._id },
      },
      { status: 'PLAYED' },
    );

    song.status = 'PLAYING';
    song.startedPlayingAt = new Date();
    await song.save();

    await EventModel.findByIdAndUpdate(eventId, {
      currentSongId: song._id,
    });

    logger.info(`Send now / playing: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_STATUS_CHANGE',
      newStatus: 'PLAYING',
    });
    return this._formatSong(song);
  }

  async skipSong(songId, eventId, reason, userId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'SKIPPED', 'DJ');

    song.status = 'SKIPPED';
    song.skippedAt = new Date();
    song.skippedBy = userId;
    song.skippedReason = reason;
    await song.save();

    logger.info(`Song skipped: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_SKIP',
      reason,
    });
    return this._formatSong(song);
  }

  async playNextSong(eventId, userId) {
    /* Validate state transition before update */
    validateTransition('APPROVED', 'PLAYING', 'DJ');

    const nextSong = await SongModel.findOneAndUpdate(
      {
        eventId,
        status: 'APPROVED',
      },
      {
        status: 'PLAYING',
        startedPlayingAt: new Date(),
      },
      { new: true, sort: { pinned: -1, voteScore: -1, sortKey: 1 } },
    );

    if (nextSong) {
      logger.info(`Playing song: ${nextSong._id}`, {
        eventId,
        userId,
        songId: nextSong._id,
        action: 'SONG_STATUS_CHANGE',
        newStatus: 'PLAYING',
      });
    }

    return nextSong ? this._formatSong(nextSong) : null;
  }

  async markSongAsPlayed(songId, eventId, userId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    /* Validate state transition using state machine */
    validateTransition(song.status, 'PLAYED', 'DJ');

    song.status = 'PLAYED';
    await song.save();

    logger.info(`Song marked as played: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_STATUS_CHANGE',
      newStatus: 'PLAYED',
    });
    return this._formatSong(song);
  }

  async getSongPosition(songId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    const queue = await this.getQueueForEvent(song.eventId);
    const queuedSong = queue.find((item) => item._id.toString() === songId.toString());

    return {
      position: queuedSong?.queuePosition ?? null,
      song: queuedSong || this._formatSong(song),
    };
  }

  async getSongStats(songId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    return {
      ...this._formatSong(song),
      voteScore: song.voteScore,
      voteCount: song.voteCount,
    };
  }

  _withQueuePositions(songs) {
    let queuedPosition = 0;
    return songs
      .slice()
      .sort((a, b) => {
        if (a.status === 'PLAYING' && b.status !== 'PLAYING') return -1;
        if (b.status === 'PLAYING' && a.status !== 'PLAYING') return 1;
        if (Number(b.pinned) !== Number(a.pinned)) {
          return Number(b.pinned) - Number(a.pinned);
        }
        if ((b.voteScore || 0) !== (a.voteScore || 0)) {
          return (b.voteScore || 0) - (a.voteScore || 0);
        }
        return String(a.sortKey).localeCompare(String(b.sortKey));
      })
      .map((song) => {
        const formatted = this._formatSong(song);
        formatted.queuePosition =
          song.status === 'PLAYING' ? 0 : ++queuedPosition;
        return formatted;
      });
  }

  _buildNowPlaying(queue) {
    const playing = queue.find((song) => song.status === 'PLAYING');
    if (!playing) return null;

    const startedAt = playing.playingStartedAt || playing.startedPlayingAt;
    const elapsedTime = startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : 0;
    const totalDuration = playing.totalDuration || playing.duration || 0;

    return {
      songId: playing._id || playing.id,
      title: playing.title,
      artist: playing.artist,
      totalDuration,
      duration: totalDuration,
      playingStartedAt: startedAt,
      startedPlayingAt: startedAt,
      elapsedTime,
      remainingTime: totalDuration ? Math.max(0, totalDuration - elapsedTime) : null,
    };
  }

  _formatSong(song) {
    const totalDuration = song.totalDuration ?? song.duration;

    return {
      _id: song._id,
      id: song._id,
      eventId: song.eventId,
      title: song.title,
      artist: song.artist,
      requestedBy: song.requestedBy,
      status: song.status,
      voteScore: song.voteScore,
      voteCount: song.voteCount,
      queuePosition: song.queuePosition,
      totalDuration,
      duration: totalDuration,
      pinned: song.pinned,
      startedPlayingAt: song.startedPlayingAt,
      playingStartedAt: song.startedPlayingAt,
      skippedAt: song.skippedAt,
      createdAt: song.createdAt,
    };
  }
}

module.exports = new SongsService();
