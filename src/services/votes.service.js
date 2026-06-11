const { VoteModel, SongModel, EventModel } = require('../models/schema');
const { logger } = require('../utils');
const { ValidationError, NotFoundError } = require('../errors');
const participantsService = require('./participants.service');

const AUTO_REJECT_REASON = 'Rejected by downvotes';

// Premium vote weights more
const PREMIUM_VOTE_WEIGHT = 2;
const REGULAR_VOTE_WEIGHT = 1;

class VotesService {
  async castVote(songId, participantId, value, actorUser) {
    /* Validate vote value */
    if (![1, -1].includes(value)) {
      throw new ValidationError('Vote value must be 1 or -1');
    }

    /* Check if song exists */
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    const settings = await this._getEventSettings(song.eventId);
    if (settings.votingEnabled === false) {
      throw new ValidationError('Voting is disabled for this event');
    }
    if (value === -1 && settings.allowDownvotes === false) {
      throw new ValidationError('Downvotes are disabled for this event');
    }

    await participantsService.ensureParticipantCanInteract(
      participantId,
      song.eventId,
      { checkCooldown: true, actorUser },
    );

    /* Get voter's premium status captured at vote time */
    const voter = await participantsService.getParticipantById(participantId);

    /* Check if participant already voted */
    const existingVote = await VoteModel.findOne({ songId, participantId });

    if (existingVote) {
      /* Update existing vote */
      const wasRejected = song.status === 'REJECTED';
      existingVote.value = value;
      existingVote.isPremiumVote = voter?.isPremium || false;
      await existingVote.save();

      await this._recalculateSongVoteState(song, settings);
      await song.save();

      logger.info(`Vote updated for song ${songId}: ${value}, new score: ${song.voteScore}, downvotes: ${song.downvoteCount}`);
      const formattedVote = this._formatVote(existingVote);
      return {
        ...formattedVote,
        vote: formattedVote,
        song: this._formatSongVoteState(song),
        autoRejected: !wasRejected && song.status === 'REJECTED' && song.autoRejectedAt,
      };
    }

    /* Create new vote */
    const vote = new VoteModel({
      songId,
      participantId,
      value,
      isPremiumVote: voter?.isPremium || false,
    });

    await vote.save();

    const wasRejected = song.status === 'REJECTED';
    await this._recalculateSongVoteState(song, settings);
    await song.save();

    logger.info(`Vote cast for song ${songId}: ${value}, new score: ${song.voteScore}, downvotes: ${song.downvoteCount}`);
    const formattedVote = this._formatVote(vote);
    return {
      ...formattedVote,
      vote: formattedVote,
      song: this._formatSongVoteState(song),
      autoRejected: !wasRejected && song.status === 'REJECTED' && song.autoRejectedAt,
    };
  }

  async removeVote(songId, participantId, actorUser) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    await participantsService.ensureParticipantCanInteract(
      participantId,
      song.eventId,
      { checkCooldown: true, actorUser },
    );

    const vote = await VoteModel.findOneAndDelete({ songId, participantId });

    if (!vote) {
      throw new NotFoundError('Vote not found');
    }

    if (song) {
      await this._recalculateSongVoteState(song);
      await song.save();
    }

    logger.info(`Vote removed for song ${songId}`);
    return { success: true, song: this._formatSongVoteState(song) };
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
        downvotes: s.downvoteCount || 0,
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

  async _getEventSettings(eventId) {
    const event = await EventModel.findById(eventId).select('settings').lean();
    if (!event) throw new NotFoundError('Event not found');
    return event.settings || {};
  }

  _voteWeight(vote, settings = {}) {
    if (settings.premiumVotesEnabled === false) return REGULAR_VOTE_WEIGHT;
    return vote.isPremiumVote ? PREMIUM_VOTE_WEIGHT : REGULAR_VOTE_WEIGHT;
  }

  async _recalculateSongVoteState(song, settings = null) {
    const resolvedSettings = settings || (await this._getEventSettings(song.eventId));
    const votes = await VoteModel.find({ songId: song._id }).select('value isPremiumVote').lean();

    song.voteScore = 0;
    song.downvoteCount = 0;
    song.voteCount = votes.length;

    for (const vote of votes) {
      const weight = this._voteWeight(vote, resolvedSettings);
      if (vote.value === 1) song.voteScore += weight;
      if (vote.value === -1) song.downvoteCount += weight;
    }

    await this._applyLadderEffects(song, resolvedSettings);
    await this._applyAutoReject(song);
    return song;
  }

  async _applyLadderEffects(song, settings) {
    if (song.status !== 'PENDING') return;

    const resolvedSettings = settings || (await this._getEventSettings(song.eventId));

    if ((song.downvoteCount || 0) >= await this._getAutoRejectThreshold(song.eventId)) {
      song.status = 'REJECTED';
      song.autoRejectedAt = new Date();
      song.removedAt = song.autoRejectedAt;
      song.removalReason = AUTO_REJECT_REASON;
      return;
    }

    const threshold = resolvedSettings.approveLadderThreshold ?? 3;
    if (song.voteScore >= threshold) {
      song.status = 'APPROVED';
    }
  }

  async _applyAutoReject(song) {
    if (song.status === 'PENDING') return;
    if (!['APPROVED', 'PLAYING'].includes(song.status)) return;

    if ((song.downvoteCount || 0) >= await this._getAutoRejectThreshold(song.eventId)) {
      const wasPlaying = song.status === 'PLAYING';
      song.status = 'REJECTED';
      song.autoRejectedAt = new Date();
      song.removedAt = song.autoRejectedAt;
      song.removalReason = AUTO_REJECT_REASON;
      if (wasPlaying) {
        await EventModel.updateOne(
          { _id: song.eventId, currentSongId: song._id },
          { $unset: { currentSongId: '' } },
        );
      }
    }
  }

  async _getAutoRejectThreshold(eventId) {
    const attendees = await participantsService.countActiveParticipants(eventId);
    return Math.max(1, Math.ceil(attendees / 2));
  }

  async recomputeActiveSongsForEvent(eventId) {
    const songs = await SongModel.find({
      eventId,
      status: { $in: ['PENDING', 'APPROVED', 'PLAYING'] },
    });
    const settings = await this._getEventSettings(eventId);
    const changedSongs = [];
    const rejectedSongs = [];

    for (const song of songs) {
      const before = {
        voteScore: song.voteScore || 0,
        downvoteCount: song.downvoteCount || 0,
        voteCount: song.voteCount || 0,
        status: song.status,
      };
      await this._recalculateSongVoteState(song, settings);
      if (
        before.voteScore !== song.voteScore ||
        before.downvoteCount !== (song.downvoteCount || 0) ||
        before.voteCount !== song.voteCount ||
        before.status !== song.status
      ) {
        await song.save();
        changedSongs.push(this._formatSongVoteState(song));
        if (before.status !== 'REJECTED' && song.status === 'REJECTED') {
          rejectedSongs.push(this._formatSongVoteState(song));
        }
      }
    }

    return { changedSongs, rejectedSongs };
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
      downvoteCount: song.downvoteCount || 0,
      voteCount: song.voteCount,
      autoRejectedAt: song.autoRejectedAt,
      removalReason: song.removalReason,
    };
  }
}

module.exports = new VotesService();
