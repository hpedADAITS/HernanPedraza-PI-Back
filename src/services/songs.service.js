const {
  SongModel,
  EventActionLogModel,
  ParticipantModel,
} = require('../models/schema');
const { logger } = require('../utils');
const { ValidationError, NotFoundError } = require('../errors');

class SongsService {
  async suggestSong(eventId, participantId, title, artist) {
    /* Check if participant is on cooldown */
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    if (participant.cooldownUntil && participant.cooldownUntil > new Date()) {
      throw new ValidationError('Participant is on cooldown');
    }

    const song = new SongModel({
      eventId,
      title,
      artist,
      requestedBy: participantId,
      status: 'PENDING',
      sortKey: `${Date.now()}_${Math.random()}`,
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
      .populate('requestedBy', 'nickname')
      .sort({ pinned: -1, voteScore: -1, sortKey: 1 });

    return songs.map((s) => this._formatSong(s));
  }

  async getPendingSongsForEvent(eventId) {
    const songs = await SongModel.find({
      eventId,
      status: 'PENDING',
    })
      .populate('requestedBy', 'nickname')
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

    song.status = 'APPROVED';
    await song.save();

    await EventActionLogModel.create({
      eventId,
      actorUserId: userId,
      type: 'SONG_APPROVE',
      songId,
    });

    logger.info(`Song approved: ${song._id}`);
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

    song.status = 'REJECTED';
    await song.save();

    await EventActionLogModel.create({
      eventId,
      actorUserId: userId,
      type: 'SONG_REJECT',
      songId,
      meta: { reason },
    });

    logger.info(`Song rejected: ${song._id}`);
    return this._formatSong(song);
  }

  async skipSong(songId, eventId, reason, userId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    song.status = 'SKIPPED';
    song.skippedAt = new Date();
    song.skippedBy = userId;
    song.skippedReason = reason;
    await song.save();

    await EventActionLogModel.create({
      eventId,
      actorUserId: userId,
      type: 'SONG_SKIP',
      songId,
      meta: { reason },
    });

    logger.info(`Song skipped: ${song._id}`);
    return this._formatSong(song);
  }

  async playNextSong(eventId, userId) {
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
      await EventActionLogModel.create({
        eventId,
        actorUserId: userId,
        type: 'SONG_STATUS_CHANGE',
        songId: nextSong._id,
        meta: { newStatus: 'PLAYING' },
      });

      logger.info(`Playing song: ${nextSong._id}`);
    }

    return nextSong ? this._formatSong(nextSong) : null;
  }

  async markSongAsPlayed(songId, eventId, userId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    song.status = 'PLAYED';
    await song.save();

    await EventActionLogModel.create({
      eventId,
      actorUserId: userId,
      type: 'SONG_STATUS_CHANGE',
      songId,
      meta: { newStatus: 'PLAYED' },
    });

    logger.info(`Song marked as played: ${song._id}`);
    return this._formatSong(song);
  }

  async getSongPosition(songId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    const position = await SongModel.countDocuments({
      eventId: song.eventId,
      status: { $in: ['APPROVED', 'PLAYING'] },
      $or: [
        { pinned: true, sortKey: { $lt: song.sortKey } },
        { pinned: false, voteScore: { $gt: song.voteScore } },
        {
          pinned: false,
          voteScore: song.voteScore,
          sortKey: { $lt: song.sortKey },
        },
      ],
    });

    return { position: position + 1, song: this._formatSong(song) };
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

  _formatSong(song) {
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
      pinned: song.pinned,
      startedPlayingAt: song.startedPlayingAt,
      skippedAt: song.skippedAt,
      createdAt: song.createdAt,
    };
  }
}

module.exports = new SongsService();
