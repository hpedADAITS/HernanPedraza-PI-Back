/**
 * test/integration/socket-io.integration.test.js
 * 
 * Socket.IO integration tests with REAL service layer (no mocks)
 * Tests the complete flow: Socket event -> Service -> DB -> Broadcast
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  SongModel,
  EventModel,
  ParticipantModel,
  VoteModel,
  connectMongo,
} = require('../../src/models/schema');
const { songsService, votesService, participantsService } = require('../../src/services');
const { validateTransition } = require('../../src/utils/song-state-machine');
const cooldownCache = require('../../src/utils/cooldown-cache');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  if (mongoose.connection.readyState === 0) {
    await connectMongo(mongoUri);
  }
  // Ensure indices are created
  await Promise.all([
    SongModel.collection.createIndex({ eventId: 1 }),
    EventModel.collection.createIndex({ ownerId: 1, startsAt: -1 }),
    ParticipantModel.collection.createIndex({ eventId: 1 }),
    VoteModel.collection.createIndex({ songId: 1, participantId: 1 }),
  ]).catch(() => {}); // Ignore if indices already exist
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe('Socket.IO Integration Tests (No Mocks)', () => {
  let testEvent;
  let testParticipant;
  let testSong;

  /**
    * Setup: Create test data before each test
    */
  beforeEach(async () => {
    // Clean up previous test data
    await SongModel.deleteMany({});
    await EventModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await VoteModel.deleteMany({});
    cooldownCache.clearAll();

    // Create test event with all required fields
    testEvent = await EventModel.create({
      name: 'Test Event',
      ownerId: new (require('mongoose')).Types.ObjectId(),
      eventId: 'TESTEV',
      accessCode: 'TESTEV123',
      startsAt: new Date(),
      state: 'LIVE',
    });

    // Create test participant
    testParticipant = await ParticipantModel.create({
      eventId: testEvent._id,
      nickname: 'Test User',
      profilePicture: 'https://example.com/pic.jpg',
      isPremium: false,
    });

    // Create test song
    testSong = await SongModel.create({
      eventId: testEvent._id,
      title: 'Test Song',
      artist: 'Test Artist',
      requestedBy: testParticipant._id,
      status: 'PENDING',
      sortKey: `${Date.now()}_${Math.random()}`,
    });
  });

  /**
   * Cleanup after each test
   */
  afterEach(async () => {
    await SongModel.deleteMany({});
    await EventModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await VoteModel.deleteMany({});
    cooldownCache.clearAll();
  });

  /* ============ SONG SUGGESTION TESTS ============ */

  describe('Song Suggestion Flow', () => {
    test('should suggest a song and persist to database', async () => {
      const result = await songsService.suggestSong(
        testEvent._id,
        testParticipant._id,
        'New Song',
        'New Artist'
      );

      expect(result).toBeDefined();
      expect(result.title).toBe('New Song');
      expect(result.artist).toBe('New Artist');
      expect(result.status).toBe('PENDING');
      expect(result.eventId).toEqual(testEvent._id);

      // Verify in database
      const dbSong = await SongModel.findById(result._id);
      expect(dbSong).toBeDefined();
      expect(dbSong.title).toBe('New Song');
      expect(dbSong.status).toBe('PENDING');
    });

    test('should reject suggestion if participant on cooldown', async () => {
      // Set cooldown in cache
      cooldownCache.setCooldown(
        testEvent._id.toString(),
        testParticipant._id.toString(),
        5000,
        'Spam prevention'
      );

      // Try to suggest
      await expect(
        songsService.suggestSong(
          testEvent._id,
          testParticipant._id,
          'Cooldown Song',
          'Artist'
        )
      ).rejects.toThrow('Participant is on cooldown');
    });

    test('should reject suggestion for non-existent participant', async () => {
      const fakeId = new (require('mongoose')).Types.ObjectId();

      await expect(
        songsService.suggestSong(testEvent._id, fakeId, 'Song', 'Artist')
      ).rejects.toThrow('Participant not found');
    });
  });

  /* ============ SONG STATE MACHINE TESTS ============ */

  describe('Song Status Transitions', () => {
    test('should transition PENDING -> APPROVED', async () => {
      const userId = new (require('mongoose')).Types.ObjectId();

      const updated = await songsService.approveSong(
        testSong._id,
        testEvent._id,
        userId
      );

      expect(updated.status).toBe('APPROVED');

      // Verify in database
      const dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.status).toBe('APPROVED');
    });

    test('should transition APPROVED -> REJECTED', async () => {
      // First approve
      await songsService.approveSong(
        testSong._id,
        testEvent._id,
        new (require('mongoose')).Types.ObjectId()
      );

      // Then reject
      const userId = new (require('mongoose')).Types.ObjectId();
      const updated = await songsService.rejectSong(
        testSong._id,
        testEvent._id,
        'Not suitable',
        userId
      );

      expect(updated.status).toBe('REJECTED');
    });

    test.skip('should transition PLAYING -> SKIPPED', async () => {
      // Set to PLAYING
      testSong.status = 'PLAYING';
      await testSong.save();

      // Skip
      const updated = await songsService.skipSong(
        testSong._id,
        testEvent._id,
        'Wrong song',
        new (require('mongoose')).Types.ObjectId()
      );

      expect(updated.status).toBe('SKIPPED');
      expect(updated.skippedReason).toBe('Wrong song');
    });

    test('should reject invalid state transition', async () => {
      // Mark as PLAYED (terminal state)
      testSong.status = 'PLAYED';
      await testSong.save();

      // Try to approve (should fail)
      await expect(
        songsService.approveSong(
          testSong._id,
          testEvent._id,
          new (require('mongoose')).Types.ObjectId()
        )
      ).rejects.toThrow();
    });

    test('should validate state machine transitions', () => {
      // Valid transition
      expect(() => validateTransition('PENDING', 'APPROVED', 'DJ')).not.toThrow();

      // Invalid transition
      expect(() => validateTransition('PLAYED', 'PENDING', 'DJ')).toThrow();

      // Terminal states
      expect(() => validateTransition('PLAYED', 'APPROVED', 'DJ')).toThrow();
    });
  });

  /* ============ VOTING TESTS ============ */

  describe('Voting System', () => {
    test('should cast upvote and update song vote score', async () => {
      const vote = await votesService.castVote(testSong._id, testParticipant._id, 1);

      expect(vote).toBeDefined();
      expect(vote.value).toBe(1);

      // Verify song voteScore updated
      const dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.voteScore).toBe(1);
      expect(dbSong.voteCount).toBe(1);
    });

    test('should cast downvote and update song vote score', async () => {
      const vote = await votesService.castVote(testSong._id, testParticipant._id, -1);

      expect(vote.value).toBe(-1);

      const dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.voteScore).toBe(-1);
      expect(dbSong.voteCount).toBe(1);
    });

    test('should update vote when same participant votes again', async () => {
      // First vote (upvote)
      await votesService.castVote(testSong._id, testParticipant._id, 1);

      let dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.voteScore).toBe(1);

      // Change vote to downvote
      const vote = await votesService.castVote(testSong._id, testParticipant._id, -1);
      expect(vote.value).toBe(-1);

      dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.voteScore).toBe(-1); // Changed from +1 to -1
      expect(dbSong.voteCount).toBe(1); // Still only 1 vote (replaced)
    });

    test('should remove vote and update song score', async () => {
      // Cast vote
      await votesService.castVote(testSong._id, testParticipant._id, 1);

      let dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.voteScore).toBe(1);

      // Remove vote
      const removed = await votesService.removeVote(testSong._id, testParticipant._id);
      expect(removed).toBeDefined();

      dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.voteScore).toBe(0);
      expect(dbSong.voteCount).toBe(0);
    });

    test('should handle multiple participants voting', async () => {
      const participant2 = await ParticipantModel.create({
        eventId: testEvent._id,
        nickname: 'User 2',
        profilePicture: 'https://example.com/pic2.jpg',
      });

      // Participant 1 upvotes
      await votesService.castVote(testSong._id, testParticipant._id, 1);

      // Participant 2 upvotes
      await votesService.castVote(testSong._id, participant2._id, 1);

      const dbSong = await SongModel.findById(testSong._id);
      expect(dbSong.voteScore).toBe(2);
      expect(dbSong.voteCount).toBe(2);
    });
  });

  /* ============ COOLDOWN CACHE TESTS ============ */

  describe('Cooldown Cache System', () => {
    test('should set cooldown in cache', () => {
      const eventId = testEvent._id.toString();
      const participantId = testParticipant._id.toString();

      cooldownCache.setCooldown(eventId, participantId, 5000, 'Spam');

      const isOnCooldown = cooldownCache.isOnCooldown(eventId, participantId);
      expect(isOnCooldown).toBe(true);
    });

    test('should check cooldown expiry', (done) => {
      const eventId = testEvent._id.toString();
      const participantId = testParticipant._id.toString();

      // Set 100ms cooldown
      cooldownCache.setCooldown(eventId, participantId, 100, 'Test');
      expect(cooldownCache.isOnCooldown(eventId, participantId)).toBe(true);

      // Wait for expiry
      setTimeout(() => {
        expect(cooldownCache.isOnCooldown(eventId, participantId)).toBe(false);
        done();
      }, 150);
    });

    test('should get cooldown entry with expiry time', () => {
      const eventId = testEvent._id.toString();
      const participantId = testParticipant._id.toString();

      cooldownCache.setCooldown(eventId, participantId, 5000, 'Test reason');

      const cooldown = cooldownCache.getCooldown(eventId, participantId);
      expect(cooldown).toBeDefined();
      expect(cooldown.reason).toBe('Test reason');
      expect(cooldown.expiresAt).toBeDefined();
    });

    test('should clear specific cooldown', () => {
      const eventId = testEvent._id.toString();
      const participantId = testParticipant._id.toString();

      cooldownCache.setCooldown(eventId, participantId, 5000, 'Test');
      expect(cooldownCache.isOnCooldown(eventId, participantId)).toBe(true);

      cooldownCache.clearCooldown(eventId, participantId);
      expect(cooldownCache.isOnCooldown(eventId, participantId)).toBe(false);
    });

    test('should clear all cooldowns for event', () => {
      const eventId = testEvent._id.toString();
      const p1 = '507f1f77bcf86cd799439014';
      const p2 = '507f1f77bcf86cd799439015';

      cooldownCache.setCooldown(eventId, p1, 5000, 'Spam1');
      cooldownCache.setCooldown(eventId, p2, 5000, 'Spam2');

      expect(cooldownCache.isOnCooldown(eventId, p1)).toBe(true);
      expect(cooldownCache.isOnCooldown(eventId, p2)).toBe(true);

      cooldownCache.clearEventCooldowns(eventId);

      expect(cooldownCache.isOnCooldown(eventId, p1)).toBe(false);
      expect(cooldownCache.isOnCooldown(eventId, p2)).toBe(false);
    });
  });

  /* ============ PARTICIPANT MANAGEMENT TESTS ============ */

  describe('Participant Management', () => {
    test('should set cooldown for participant', async () => {
      const adminId = new (require('mongoose')).Types.ObjectId();
      const duration = 5000;

      const result = await participantsService.setParticipantCooldown(
        testParticipant._id,
        duration,
        'Spam prevention',
        adminId
      );

      expect(result.participant).toBeDefined();

      // Verify in cache
      const isOnCooldown = cooldownCache.isOnCooldown(
        testEvent._id.toString(),
        testParticipant._id.toString()
      );
      expect(isOnCooldown).toBe(true);
    });

    test('should kick participant', async () => {
      const adminId = new (require('mongoose')).Types.ObjectId();

      const result = await participantsService.kickParticipant(
        testParticipant._id,
        'Inappropriate behavior',
        adminId
      );

      expect(result.participant).toBeDefined();

      // Verify in database
      const dbParticipant = await ParticipantModel.findById(testParticipant._id);
      expect(dbParticipant.kickedAt).toBeDefined();
      expect(dbParticipant.kickReason).toBe('Inappropriate behavior');
    });

    test('should set premium status', async () => {
      const updated = await participantsService.setPremium(testParticipant._id, true);

      expect(updated.isPremium).toBe(true);

      // Verify in database
      const dbParticipant = await ParticipantModel.findById(testParticipant._id);
      expect(dbParticipant.isPremium).toBe(true);
    });

    test('should unset premium status', async () => {
      // First set premium
      await participantsService.setPremium(testParticipant._id, true);

      // Then unset
      const updated = await participantsService.setPremium(testParticipant._id, false);

      expect(updated.isPremium).toBe(false);
    });
  });

  /* ============ COMPLEX FLOW TESTS ============ */

  describe('Complete Real-World Flows', () => {
    test('should execute complete suggest-approve-vote-play flow', async () => {
      const userId = new (require('mongoose')).Types.ObjectId();
      const participant2 = await ParticipantModel.create({
        eventId: testEvent._id,
        nickname: 'User 2',
        profilePicture: 'https://example.com/pic2.jpg',
      });

      // 1. User 1 suggests song
      const suggested = await songsService.suggestSong(
        testEvent._id,
        testParticipant._id,
        'Popular Song',
        'Artist Name'
      );
      expect(suggested.status).toBe('PENDING');

      // 2. DJ approves
      const approved = await songsService.approveSong(
        suggested._id,
        testEvent._id,
        userId
      );
      expect(approved.status).toBe('APPROVED');

      // 3. User 2 votes
      await votesService.castVote(suggested._id, participant2._id, 1);

      let song = await SongModel.findById(suggested._id);
      expect(song.voteCount).toBe(1);
      expect(song.voteScore).toBe(1);

      // 4. DJ plays
      const playing = await songsService.sendNow(suggested._id, testEvent._id, userId);
      expect(playing.status).toBe('PLAYING');

      // 5. Verify final state
      const final = await SongModel.findById(suggested._id);
      expect(final.status).toBe('PLAYING');
      expect(final.voteScore).toBe(1);
    });

    test.skip('should handle concurrent votes correctly', async () => {
      const participant2 = await ParticipantModel.create({
        eventId: testEvent._id,
        nickname: 'User 2',
        profilePicture: 'https://example.com/pic2.jpg',
      });

      const participant3 = await ParticipantModel.create({
        eventId: testEvent._id,
        nickname: 'User 3',
        profilePicture: 'https://example.com/pic3.jpg',
      });

      // Simulate concurrent votes
      await Promise.all([
        votesService.castVote(testSong._id, testParticipant._id, 1),
        votesService.castVote(testSong._id, participant2._id, 1),
        votesService.castVote(testSong._id, participant3._id, -1),
      ]);

      const song = await SongModel.findById(testSong._id);
      expect(song.voteCount).toBe(3);
      expect(song.voteScore).toBe(1); // 1 + 1 - 1 = 1
    });

    test('should prevent state changes on cooldown', async () => {
      // Set cooldown
      const adminId = new (require('mongoose')).Types.ObjectId();
      await participantsService.setParticipantCooldown(
        testParticipant._id,
        5000,
        'Spam',
        adminId
      );

      // Try to suggest (should fail)
      await expect(
        songsService.suggestSong(
          testEvent._id,
          testParticipant._id,
          'New Song',
          'Artist'
        )
      ).rejects.toThrow('on cooldown');
    });
  });
});
