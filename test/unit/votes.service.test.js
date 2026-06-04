/**
 * Unit tests for votesService.js
 * Tests vote casting, removal, auto-rejection, and vote statistics
 */

jest.mock('../../src/models/schema', () => ({
  VoteModel: {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue([]),
    }),
    findOneAndDelete: jest.fn().mockResolvedValue(null),
    prototype: { validateSync: jest.fn() },
  },
  SongModel: {
    findById: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue([]),
    }),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue({}),
  },
  ParticipantModel: {
    findById: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../src/services/participants.service', () => ({
  ensureParticipantCanInteract: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/utils', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { VoteModel, SongModel } = require('../../src/models/schema');
const participantsService = require('../../src/services/participants.service');
const votesService = require('../../src/services/votes.service');

describe('VotesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('castVote validation', () => {
    test('should throw ValidationError for invalid vote value 0', async () => {
      await expect(votesService.castVote('song-1', 'participant-1', 0, {}))
        .rejects.toThrow('Vote value must be 1 or -1');
    });

    test('should throw ValidationError for invalid vote value 2', async () => {
      await expect(votesService.castVote('song-1', 'participant-1', 2, {}))
        .rejects.toThrow('Vote value must be 1 or -1');
    });

    test('should throw NotFoundError when song not found', async () => {
      SongModel.findById.mockResolvedValue(null);

      await expect(votesService.castVote('invalid-song', 'participant-1', 1, {}))
        .rejects.toThrow('Song not found');
    });
  });

  describe('removeVote', () => {
    test('should throw NotFoundError when song not found', async () => {
      SongModel.findById.mockResolvedValue(null);

      await expect(votesService.removeVote('invalid-song', 'participant-1', {}))
        .rejects.toThrow('Song not found');
    });

    test('should remove vote and update score', async () => {
      const mockSong = {
        _id: 'song-1',
        eventId: 'event-1',
        voteScore: 3,
        voteCount: 2,
        save: jest.fn().mockResolvedValue(true),
      };

      const mockVote = {
        _id: 'vote-1',
        songId: 'song-1',
        participantId: 'participant-1',
        value: 1,
      };

      SongModel.findById.mockResolvedValue(mockSong);
      VoteModel.findOneAndDelete.mockResolvedValue(mockVote);

      const result = await votesService.removeVote('song-1', 'participant-1', {});

      expect(result.success).toBe(true);
      expect(mockSong.voteScore).toBe(2);
      expect(mockSong.voteCount).toBe(1);
    });
  });

  describe('getVoteStats', () => {
    test('should return vote statistics', async () => {
      const mockSongs = [
        { _id: 'song-1', title: 'Song A', voteScore: 5, voteCount: 3 },
        { _id: 'song-2', title: 'Song B', voteScore: 3, voteCount: 2 },
      ];

      SongModel.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockSongs),
      });

      const result = await votesService.getVoteStats('event-1');

      expect(result.total_songs).toBe(2);
      expect(result.top_voted).toHaveLength(2);
      expect(result.stats.total_votes).toBe(8);
    });

    test('should return empty stats when no songs', async () => {
      SongModel.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      });

      const result = await votesService.getVoteStats('event-1');

      expect(result.total_songs).toBe(0);
      expect(result.stats.average_votes_per_song).toBe(0);
    });
  });

  describe('getParticipantVote', () => {
    test('should return vote when exists', async () => {
      const mockVote = {
        _id: 'vote-1',
        songId: 'song-1',
        participantId: 'participant-1',
        value: 1,
        createdAt: new Date(),
      };

      VoteModel.findOne.mockResolvedValue(mockVote);

      const result = await votesService.getParticipantVote('song-1', 'participant-1');

      expect(result).toBeDefined();
      expect(result.value).toBe(1);
    });

    test('should return null when no vote', async () => {
      VoteModel.findOne.mockResolvedValue(null);

      const result = await votesService.getParticipantVote('song-1', 'no-vote');

      expect(result).toBeNull();
    });
  });

  describe('auto-rejection logic', () => {
    test('should auto-reject PENDING song at score -8', async () => {
      const song = {
        _id: 'song-1',
        eventId: 'event-1',
        status: 'PENDING',
        voteScore: -8,
        save: jest.fn().mockResolvedValue(true),
      };

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('REJECTED');
    });

    test('should auto-reject APPROVED at score -8', async () => {
      const song = {
        _id: 'song-1',
        eventId: 'event-1',
        status: 'APPROVED',
        voteScore: -8,
        save: jest.fn().mockResolvedValue(true),
      };

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('REJECTED');
    });

    test('should not auto-reject PLAYING songs even with negative score', async () => {
      const song = {
        _id: 'song-1',
        status: 'PLAYING',
        voteScore: -10,
        save: jest.fn().mockResolvedValue(true),
      };

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('PLAYING');
    });

    test('should not change if score is above threshold', async () => {
      const song = {
        _id: 'song-1',
        status: 'PENDING',
        voteScore: -7,
        save: jest.fn().mockResolvedValue(true),
      };

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('PENDING');
    });
  });
});