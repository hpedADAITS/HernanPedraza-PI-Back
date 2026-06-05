/**
 * Unit tests for votesService.js - UNMOCKED
 * Tests vote casting, removal, auto-rejection, and vote statistics using REAL implementations
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  VoteModel,
  SongModel,
  EventModel,
  ParticipantModel,
  UserModel,
} = require('../../src/models/schema');
const votesService = require('../../src/services/votes.service');
const participantsService = require('../../src/services/participants.service');
const eventsService = require('../../src/services/events.service');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    VoteModel.deleteMany({}),
    SongModel.deleteMany({}),
    EventModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

// Helper to create a real test event
const createTestEvent = async (overrides = {}) => {
  const user = await UserModel.create({
    email: `dj-${Date.now()}@test.com`,
    passwordHash: 'hashed',
    displayName: 'Test DJ',
    role: 'DJ',
    isActive: true,
  });

  const event = await EventModel.create({
    name: 'Test Event',
    ownerId: user._id,
    eventId: `EVENT-${Date.now()}`,
    accessCode: `TEST${Date.now()}CODE`,
    state: 'LIVE',
    startsAt: new Date(),
    ...overrides,
  });

  return { event, user };
};

// Helper to create a real participant
const createTestParticipant = async (eventId, overrides = {}) => {
  const nickname = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Create a linked user if userId is not provided
  let user = overrides.userId;
  if (!user) {
    const userEmail = `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@test.com`;
    user = await UserModel.create({
      email: userEmail,
      passwordHash: 'hashed',
      displayName: nickname,
      role: 'ATTENDEE',
      isActive: true,
    });
  }
  
  const participant = await ParticipantModel.create({
    eventId,
    nickname,
    isBanned: false,
    leftAt: null,
    userId: user._id,
    ...overrides,
  });
  
  // Update participant with user reference if needed
  participant.userId = user._id;
  await participant.save();
  
  return participant;
};

// Helper to create a real song
const createTestSong = async (eventId, requestedByParticipantId, overrides = {}) => {
  return SongModel.create({
    title: 'Test Song',
    artist: 'Test Artist',
    eventId,
    requestedBy: requestedByParticipantId,
    status: 'PENDING',
    voteScore: 0,
    voteCount: 0,
    sortKey: `${Date.now()}_test-song`,
    ...overrides,
  });
};

describe('VotesService - Real Implementation Tests', () => {
  describe('castVote validation', () => {
    test('should throw ValidationError for invalid vote value 0', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id);

      await expect(
        votesService.castVote(song._id, participant._id, 0, { userId: participant.userId?.toString() })
      ).rejects.toThrow('Vote value must be 1 or -1');
    });

    test('should throw ValidationError for invalid vote value 2', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id);

      await expect(
        votesService.castVote(song._id, participant._id, 2, { userId: participant.userId?.toString() })
      ).rejects.toThrow('Vote value must be 1 or -1');
    });

    test('should throw NotFoundError when song not found', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const fakeSongId = new mongoose.Types.ObjectId();

      await expect(
        votesService.castVote(fakeSongId, participant._id, 1, { userId: participant.userId?.toString() })
      ).rejects.toThrow('Song not found');
    });
  });

  describe('removeVote', () => {
    test('should throw NotFoundError when song not found', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const fakeSongId = new mongoose.Types.ObjectId();

      await expect(
        votesService.removeVote(fakeSongId, participant._id, { userId: participant.userId?.toString() })
      ).rejects.toThrow('Song not found');
    });

    test('should remove vote and update score', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, { voteScore: 3, voteCount: 2 });

      // Create a real vote
      const vote = await VoteModel.create({
        songId: song._id,
        participantId: participant._id,
        value: 1,
      });

      // Now test removal
      const result = await votesService.removeVote(song._id, participant._id, { userId: participant.userId?.toString() });

      expect(result.success).toBe(true);

      // Verify vote was deleted
      const deletedVote = await VoteModel.findById(vote._id);
      expect(deletedVote).toBeNull();

      // Verify song score was updated
      const updatedSong = await SongModel.findById(song._id);
      expect(updatedSong.voteScore).toBe(2);
      expect(updatedSong.voteCount).toBe(1);
    });
  });

  describe('getVoteStats', () => {
    test('should return vote statistics', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      // Create songs with different vote scores
      await SongModel.create([
        { title: 'Song A', artist: 'Artist', eventId: event._id, requestedBy: participant._id, status: 'APPROVED', voteScore: 5, voteCount: 3, sortKey: '1_song_a' },
        { title: 'Song B', artist: 'Artist', eventId: event._id, requestedBy: participant._id, status: 'APPROVED', voteScore: 3, voteCount: 2, sortKey: '2_song_b' },
      ]);

      const result = await votesService.getVoteStats(event._id);

      expect(result.total_songs).toBe(2);
      expect(result.top_voted).toHaveLength(2);
      expect(result.top_voted[0].votes).toBe(5);
      expect(result.top_voted[1].votes).toBe(3);
      expect(result.stats.total_votes).toBe(8); // |5|+|3| = 8
    });

    test('should return empty stats when no songs', async () => {
      const { event } = await createTestEvent();

      const result = await votesService.getVoteStats(event._id);

      expect(result.total_songs).toBe(0);
      expect(result.top_voted).toHaveLength(0);
      expect(result.stats.total_votes).toBe(0);
      expect(result.stats.average_votes_per_song).toBe(0);
    });
  });

  describe('getParticipantVote', () => {
    test('should return vote when exists', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id);

      const vote = await VoteModel.create({
        songId: song._id,
        participantId: participant._id,
        value: 1,
      });

      const result = await votesService.getParticipantVote(song._id, participant._id);

      expect(result).toBeDefined();
      expect(result.value).toBe(1);
      expect(result.participantId.toString()).toBe(participant._id.toString());
    });

    test('should return null when no vote', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id);

      const result = await votesService.getParticipantVote(song._id, participant._id);

      expect(result).toBeNull();
    });
  });

  describe('auto-rejection logic', () => {
    test('should auto-reject PENDING song at score -8', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, {
        status: 'PENDING',
        voteScore: -8,
      });

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('REJECTED');
    });

    test('should auto-reject APPROVED at score -8', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: -8,
      });

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('REJECTED');
    });

    test('should not auto-reject PLAYING songs even with negative score', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, {
        status: 'PLAYING',
        voteScore: -10,
      });

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('PLAYING');
    });

    test('should not change if score is above threshold', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, {
        status: 'PENDING',
        voteScore: -7,
      });

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('PENDING');
    });

    test('should use custom skipThreshold from event settings', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      
      // Update event with custom skip threshold
      await EventModel.findByIdAndUpdate(event._id, {
        settings: { skipThreshold: -5 }
      });

      const song = await createTestSong(event._id, participant._id, {
        status: 'PENDING',
        voteScore: -5, // Would be rejected with threshold -5
      });

      await votesService._applyAutoReject(song);

      expect(song.status).toBe('REJECTED');
    });
  });

  describe('vote weight for premium users', () => {
    test('should apply weight 2 for premium votes', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { isPremium: true });
      const song = await createTestSong(event._id, participant._id);

      const result = await votesService.castVote(song._id, participant._id, 1, { userId: participant.userId?.toString() });

      // Verify the song score increased by premium weight (2)
      const updatedSong = await SongModel.findById(song._id);
      expect(updatedSong.voteScore).toBe(2);
    });

    test('should apply weight 1 for regular votes', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { isPremium: false });
      const song = await createTestSong(event._id, participant._id);

      const result = await votesService.castVote(song._id, participant._id, 1, { userId: participant.userId?.toString() });

      // Verify the song score increased by regular weight (1)
      const updatedSong = await SongModel.findById(song._id);
      expect(updatedSong.voteScore).toBe(1);
    });
  });
});
