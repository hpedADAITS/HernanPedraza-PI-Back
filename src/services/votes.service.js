const { VoteModel, SongModel } = require('../models/schema');
const { logger } = require('../utils');

class VotesService {
  async castVote(songId, participantId, value) {
    // Validate vote value
    if (![1, -1].includes(value)) {
      throw new Error('Vote value must be 1 or -1');
    }

    // Check if song exists
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new Error('Song not found');
    }

    // Check if participant already voted
    let existingVote = await VoteModel.findOne({ songId, participantId });

    if (existingVote) {
      // Update existing vote
      const oldValue = existingVote.value;
      existingVote.value = value;
      await existingVote.save();

      // Update song vote score
      song.voteScore = song.voteScore - oldValue + value;
      await song.save();

      logger.info(`Vote updated for song ${songId}: ${oldValue} -> ${value}`);
      return this._formatVote(existingVote);
    }

    // Create new vote
    const vote = new VoteModel({
      songId,
      participantId,
      value,
    });

    await vote.save();

    // Update song vote score
    song.voteScore += value;
    song.voteCount += 1;
    await song.save();

    logger.info(`Vote cast for song ${songId}: ${value}`);
    return this._formatVote(vote);
  }

  async removeVote(songId, participantId) {
    const vote = await VoteModel.findOneAndDelete({ songId, participantId });

    if (!vote) {
      throw new Error('Vote not found');
    }

    // Update song vote score
    const song = await SongModel.findById(songId);
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
}

module.exports = new VotesService();
