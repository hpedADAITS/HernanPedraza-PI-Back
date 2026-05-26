const { VoteModel, SongModel } = require('../models/schema');
const { logger } = require('../utils');
const { ValidationError, NotFoundError } = require('../errors');
const participantsService = require('./participants.service');

const AUTO_REJECT_SCORE = -8;
const AUTO_REJECT_REASON = 'Rejected by downvotes';

class VotesService {
  async castVote(songId, participantId, value) {
    /* Validate vote value */
    if (![1, -1].includes(value)) {
      throw new ValidationError('Vote value must be 1 or -1');
    }

    /* Check if song exists */
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    await participantsService.ensureParticipantCanInteract(
      participantId,
      song.eventId,
      { checkCooldown: true },
    );

    /* Check if participant already voted */
    let existingVote = await VoteModel.findOne({ songId, participantId });

    if (existingVote) {
      /* Update existing vote */
      const oldValue = existingVote.value;
      existingVote.value = value;
      await existingVote.save();

      /* Update song vote score */
      song.voteScore = song.voteScore - oldValue + value;
      await this._applyAutoReject(song);
      await song.save();

      logger.info(`Vote updated for song ${songId}: ${oldValue} -> ${value}`);
      const formattedVote = this._formatVote(existingVote);
      return {
        ...formattedVote,
        vote: formattedVote,
        song: this._formatSongVoteState(song),
        autoRejected: song.status === 'REJECTED' && song.autoRejectedAt,
      };
    }

    /* Create new vote */
    const vote = new VoteModel({
      songId,
      participantId,
      value,
    });

    await vote.save();

    /* Update song vote score */
    song.voteScore += value;
    song.voteCount += 1;
    await this._applyAutoReject(song);
    await song.save();

    logger.info(`Vote cast for song ${songId}: ${value}`);
    const formattedVote = this._formatVote(vote);
    return {
      ...formattedVote,
      vote: formattedVote,
      song: this._formatSongVoteState(song),
      autoRejected: song.status === 'REJECTED' && song.autoRejectedAt,
    };
  }

  async removeVote(songId, participantId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    await participantsService.ensureParticipantCanInteract(
      participantId,
      song.eventId,
      { checkCooldown: true },
    );

    const vote = await VoteModel.findOneAndDelete({ songId, participantId });

    if (!vote) {
      throw new NotFoundError('Vote not found');
    }

    /* Update song vote score */
    if (song) {
      song.voteScore -= vote.value;
      song.voteCount -= 1;
      await song.save();
    }

    logger.info(`Vote removed for song ${songId}`);
    return { success: true };
  }

  async getVoteStats(eventId) {
    const songs = await SongModel.find({
      eventId,
      status: { $in: ['PENDING', 'APPROVED', 'PLAYING'] },
    }).sort({ voteScore: -1 });

    return {
      total_songs: songs.length,
      top_voted: songs.slice(0, 10).map((s) => ({
        id: s._id,
        title: s.title,
        artist: s.artist,
        votes: s.voteScore,
        count: s.voteCount,
      })),
      stats: {
        total_votes: songs.reduce((sum, s) => sum + Math.abs(s.voteScore), 0),
        average_votes_per_song:
          songs.length > 0
            ? songs.reduce((sum, s) => sum + s.voteCount, 0) / songs.length
            : 0,
      },
    };
  }

  async getParticipantVote(songId, participantId) {
    const vote = await VoteModel.findOne({ songId, participantId });
    if (!vote) {
      return null;
    }
    return this._formatVote(vote);
  }

  async getSongVotes(songId) {
    const votes = await VoteModel.find({ songId });
    return votes.map((v) => this._formatVote(v));
  }

  _formatVote(vote) {
    return {
      id: vote._id,
      songId: vote.songId,
      participantId: vote.participantId,
      value: vote.value,
      createdAt: vote.createdAt,
    };
  }

  async _applyAutoReject(song) {
    if (
      song.voteScore <= AUTO_REJECT_SCORE &&
      ['PENDING', 'APPROVED'].includes(song.status)
    ) {
      song.status = 'REJECTED';
      song.autoRejectedAt = new Date();
      song.removedAt = song.autoRejectedAt;
      song.removalReason = AUTO_REJECT_REASON;
    }
  }

  _formatSongVoteState(song) {
    return {
      _id: song._id,
      id: song._id,
      eventId: song.eventId,
      title: song.title,
      artist: song.artist,
      status: song.status,
      voteScore: song.voteScore,
      voteCount: song.voteCount,
      autoRejectedAt: song.autoRejectedAt,
      removalReason: song.removalReason,
    };
  }
}

module.exports = new VotesService();
