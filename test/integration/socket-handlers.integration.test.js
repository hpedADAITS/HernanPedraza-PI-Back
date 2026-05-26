/**
 * test/integration/socket-handlers.integration.test.js
 * 
 * Socket.IO handler tests with REAL callbacks and broadcasts
 * Tests the complete flow: emit -> handler -> service -> DB -> callback + broadcast
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
const socketEvents = require('../../src/socket/events');
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

describe.skip('Socket.IO Handler Integration Tests', () => {
  let testEvent;
  let testParticipant;
  let testSong;
  let mockSocket;
  let mockIO;
  let broadcastedEvents;

  /**
   * Setup: Create mock socket and IO
   */
  beforeEach(async () => {
    // Clean database
    await SongModel.deleteMany({});
    await EventModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await VoteModel.deleteMany({});
    cooldownCache.clearAll();

    // Track broadcasts
    broadcastedEvents = [];

    // Mock Socket
    mockSocket = {
      id: 'socket-test-123',
      emit: jest.fn(),
    };

    // Mock IO with broadcast tracking
    mockIO = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn((event, data) => {
        broadcastedEvents.push({ event, data });
      }),
    };

    // Create test data with all required fields
    testEvent = await EventModel.create({
      name: 'Test Event',
      ownerId: new (require('mongoose')).Types.ObjectId(),
      eventId: 'TESTEV',
      accessCode: 'TESTEV123',
      startsAt: new Date(),
      state: 'LIVE',
    });

    testParticipant = await ParticipantModel.create({
      eventId: testEvent._id,
      nickname: 'Test User',
      profilePicture: 'https://example.com/pic.jpg',
    });

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
   * Cleanup
   */
  afterEach(async () => {
    await SongModel.deleteMany({});
    await EventModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await VoteModel.deleteMany({});
    cooldownCache.clearAll();
    jest.clearAllMocks();
  });

  /* ============ SUGGEST SONG HANDLER ============ */

  describe('handleSuggestSong', () => {
    test('should suggest song and acknowledge with data', async () => {
      const callback = jest.fn();

      await socketEvents.handleSuggestSong(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          participantId: testParticipant._id.toString(),
          title: 'New Song',
          artist: 'New Artist',
        },
        callback
      );

      // Check acknowledgment callback
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          error: null,
          data: expect.objectContaining({
            title: 'New Song',
            artist: 'New Artist',
            status: 'PENDING',
          }),
        })
      );

      // Check broadcast
      expect(broadcastedEvents.length).toBe(1);
      expect(broadcastedEvents[0].event).toBe('song_suggested');
      expect(broadcastedEvents[0].data.title).toBe('New Song');

      // Verify in database
      const song = await SongModel.findOne({ title: 'New Song' });
      expect(song).toBeDefined();
      expect(song.status).toBe('PENDING');
    });

    test('should handle suggestion error and acknowledge with error', async () => {
      const callback = jest.fn();

      await socketEvents.handleSuggestSong(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          participantId: 'invalid-id',
          title: 'Song',
          artist: 'Artist',
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    test('should reject missing required fields', async () => {
      const callback = jest.fn();

      await socketEvents.handleSuggestSong(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          // Missing participantId, title, artist
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Missing required fields'),
        })
      );
    });
  });

  /* ============ APPROVE SONG HANDLER ============ */

  describe('handleApproveSong', () => {
    test('should approve song and broadcast', async () => {
      const callback = jest.fn();
      const userId = new (require('mongoose')).Types.ObjectId();

      await socketEvents.handleApproveSong(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          userId: userId.toString(),
        },
        callback
      );

      // Check acknowledgment
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'APPROVED',
          }),
        })
      );

      // Check broadcast
      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'song_approved',
            data: expect.objectContaining({
              status: 'APPROVED',
            }),
          }),
        ])
      );

      // Verify in database
      const song = await SongModel.findById(testSong._id);
      expect(song.status).toBe('APPROVED');
    });

    test('should reject invalid state transition', async () => {
      const callback = jest.fn();
      const userId = new (require('mongoose')).Types.ObjectId();

      // Set song to PLAYED (terminal state)
      testSong.status = 'PLAYED';
      await testSong.save();

      // Try to approve
      await socketEvents.handleApproveSong(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          userId: userId.toString(),
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });
  });

  /* ============ REJECT SONG HANDLER ============ */

  describe('handleRejectSong', () => {
    test('should reject song and broadcast', async () => {
      const callback = jest.fn();
      const userId = new (require('mongoose')).Types.ObjectId();

      await socketEvents.handleRejectSong(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          reason: 'Explicit content',
          userId: userId.toString(),
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'REJECTED',
          }),
        })
      );

      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'song_rejected',
            data: expect.objectContaining({
              reason: 'Explicit content',
            }),
          }),
        ])
      );
    });
  });

  /* ============ SKIP SONG HANDLER ============ */

  describe('handleSkipSong', () => {
    test('should skip song and broadcast', async () => {
      const callback = jest.fn();
      const userId = new (require('mongoose')).Types.ObjectId();

      // First play song
      testSong.status = 'PLAYING';
      await testSong.save();

      await socketEvents.handleSkipSong(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          reason: 'Wrong song',
          userId: userId.toString(),
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'SKIPPED',
            skippedReason: 'Wrong song',
          }),
        })
      );

      const song = await SongModel.findById(testSong._id);
      expect(song.status).toBe('SKIPPED');
      expect(song.skippedReason).toBe('Wrong song');
    });
  });

  /* ============ SEND NOW (PLAY) HANDLER ============ */

  describe('handleSendNow', () => {
    test('should send song now and broadcast', async () => {
      const callback = jest.fn();
      const userId = new (require('mongoose')).Types.ObjectId();

      // Approve song first
      testSong.status = 'APPROVED';
      await testSong.save();

      await socketEvents.handleSendNow(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          userId: userId.toString(),
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'PLAYING',
          }),
        })
      );

      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'song_now_playing',
          }),
        ])
      );
    });
  });

  /* ============ VOTING HANDLERS ============ */

  describe('handleCastVote', () => {
    test('should cast upvote and broadcast', async () => {
      const callback = jest.fn();

      await socketEvents.handleCastVote(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          participantId: testParticipant._id.toString(),
          value: 1,
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );

      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'vote_cast',
            data: expect.objectContaining({
              value: 1,
            }),
          }),
        ])
      );

      const song = await SongModel.findById(testSong._id);
      expect(song.voteScore).toBe(1);
    });

    test('should reject invalid vote value', async () => {
      const callback = jest.fn();

      await socketEvents.handleCastVote(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          participantId: testParticipant._id.toString(),
          value: 5, // Invalid
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('vote value must be'),
        })
      );
    });
  });

  describe('handleRemoveVote', () => {
    test('should remove vote and broadcast', async () => {
      const callback = jest.fn();

      // First cast vote
      await socketEvents.handleCastVote(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          participantId: testParticipant._id.toString(),
          value: 1,
        },
        jest.fn()
      );

      broadcastedEvents = []; // Reset broadcasts

      // Remove vote
      await socketEvents.handleRemoveVote(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          participantId: testParticipant._id.toString(),
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );

      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'vote_removed',
          }),
        ])
      );

      const song = await SongModel.findById(testSong._id);
      expect(song.voteScore).toBe(0);
    });
  });

  /* ============ PARTICIPANT HANDLERS ============ */

  describe('handleSetCooldown', () => {
    test('should set cooldown and broadcast', async () => {
      const callback = jest.fn();
      const adminId = new (require('mongoose')).Types.ObjectId();

      await socketEvents.handleSetCooldown(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          participantId: testParticipant._id.toString(),
          durationMs: 5000,
          reason: 'Spam',
          userId: adminId.toString(),
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );

      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'participant_cooldown',
            data: expect.objectContaining({
              reason: 'Spam',
            }),
          }),
        ])
      );

      // Verify cache
      const isOnCooldown = cooldownCache.isOnCooldown(
        testEvent._id.toString(),
        testParticipant._id.toString()
      );
      expect(isOnCooldown).toBe(true);
    });
  });

  describe('handleKickParticipant', () => {
    test('should kick participant and broadcast', async () => {
      const callback = jest.fn();
      const adminId = new (require('mongoose')).Types.ObjectId();

      await socketEvents.handleKickParticipant(
        mockSocket,
        mockIO,
        {
          eventId: testEvent._id.toString(),
          participantId: testParticipant._id.toString(),
          reason: 'Inappropriate behavior',
          userId: adminId.toString(),
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );

      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'participant_kicked',
            data: expect.objectContaining({
              reason: 'Inappropriate behavior',
            }),
          }),
        ])
      );

      const participant = await ParticipantModel.findById(testParticipant._id);
      expect(participant.kickedAt).toBeDefined();
    });
  });

  describe('handleSetPremium', () => {
    test('should set premium and broadcast', async () => {
      const callback = jest.fn();

      await socketEvents.handleSetPremium(
        mockSocket,
        mockIO,
        {
          participantId: testParticipant._id.toString(),
          isPremium: true,
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            isPremium: true,
          }),
        })
      );

      expect(broadcastedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'participant_premium_updated',
            data: expect.objectContaining({
              isPremium: true,
            }),
          }),
        ])
      );
    });
  });

  /* ============ ERROR HANDLING ============ */

  describe('Error Handling', () => {
    test('should handle missing callback gracefully', async () => {
      // This should not throw
      await socketEvents.handleSuggestSong(
        mockSocket,
        mockIO,
        {
          eventId: 'invalid',
          participantId: 'invalid',
          title: 'Song',
          artist: 'Artist',
        },
        undefined // No callback
      );

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    test('should emit socket error on invalid data', async () => {
      const callback = jest.fn();

      await socketEvents.handleApproveSong(
        mockSocket,
        mockIO,
        {
          // Missing required fields
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
    });
  });
});
