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
  AudioTrackModel,
  ParticipantModel,
  UserModel,
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

describe('Socket.IO Handler Integration Tests', () => {
  let testEvent;
  let testParticipant;
  let testSong;
  let ownerUser;
  let attendeeUser;
  let socket;
  let ioServer;
  let broadcastedEvents;

  const useOwnerSocket = () => {
    socket.user = {
      userId: ownerUser._id.toString(),
      _id: ownerUser._id,
      role: 'DJ',
    };
  };

  /**
   * Setup: Create socket and IO capture fixtures
   */
  beforeEach(async () => {
    // Clean database
    await SongModel.deleteMany({});
    await EventModel.deleteMany({});
    await AudioTrackModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await UserModel.deleteMany({});
    await VoteModel.deleteMany({});
    cooldownCache.clearAll();

    // Track broadcasts
    broadcastedEvents = [];

    // IO capture with broadcast tracking
    ioServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn((event, data) => {
        broadcastedEvents.push({ event, data });
      }),
    };

    ownerUser = await UserModel.create({
      email: `dj-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: 'hashed-password',
      displayName: 'DJ Flow',
      role: 'DJ',
    });
    attendeeUser = await UserModel.create({
      email: `attendee-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: 'hashed-password',
      displayName: 'Test User',
      role: 'ATTENDEE',
    });

    // Create test data with all required fields
    testEvent = await EventModel.create({
      name: 'Test Event',
      ownerId: ownerUser._id,
      eventId: 'TESTEV',
      accessCode: 'TESTEV123',
      startsAt: new Date(),
      state: 'LIVE',
    });

    testParticipant = await ParticipantModel.create({
      eventId: testEvent._id,
      nickname: 'Test User',
      profilePicture: 'https://example.com/pic.jpg',
      userId: attendeeUser._id,
    });

    socket = {
      id: 'socket-test-123',
      emit: jest.fn(),
      rooms: new Set([`event:${testEvent._id}`]),
      join: jest.fn((room) => socket.rooms.add(room)),
      leave: jest.fn((room) => socket.rooms.delete(room)),
      user: {
        userId: attendeeUser._id.toString(),
        _id: attendeeUser._id,
        role: 'ATTENDEE',
      },
      eventId: testEvent._id.toString(),
      participantId: testParticipant._id.toString(),
    };

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
    await AudioTrackModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await UserModel.deleteMany({});
    await VoteModel.deleteMany({});
    cooldownCache.clearAll();
    jest.clearAllMocks();
  });

  /* ============ SUGGEST SONG HANDLER ============ */

  describe('handleSuggestSong', () => {
    test('should suggest song and acknowledge with data', async () => {
      const callback = jest.fn();

      await socketEvents.handleSuggestSong(
        socket,
        ioServer,
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
      const suggested = callback.mock.calls[0][0].data;
      const song = await SongModel.findById(suggested._id);
      expect(song).toBeDefined();
      expect(song.status).toBe('PENDING');
    });

    test('uses selected fingerprint metadata when suggesting via socket', async () => {
      const callback = jest.fn();
      const track = await AudioTrackModel.create({
        eventId: testEvent._id,
        audioSha256: 'socket-selected-track',
        title: 'Socket Canonical Title',
        artist: 'Socket Canonical Artist',
        uploadedBy: ownerUser._id,
        duration: 188,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      await socketEvents.handleSuggestSong(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          participantId: testParticipant._id.toString(),
          title: 'Socket Attendee Typo',
          artist: 'Socket Attendee Artist',
          fingerprintTrackId: track._id.toString(),
          skipMusicBrainzLookup: true,
        },
        callback,
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            title: 'Socket Canonical Title',
            artist: 'Socket Canonical Artist',
            totalDuration: 188,
          }),
        }),
      );
      expect(broadcastedEvents[0].data).toMatchObject({
        title: 'Socket Canonical Title',
        artist: 'Socket Canonical Artist',
        totalDuration: 188,
      });
    });

    test('should handle suggestion error and acknowledge with error', async () => {
      const callback = jest.fn();

      await socketEvents.handleSuggestSong(
        socket,
        ioServer,
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
        socket,
        ioServer,
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

    test('should reject malformed suggestion text', async () => {
      const callback = jest.fn();

      await socketEvents.handleSuggestSong(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          participantId: testParticipant._id.toString(),
          title: '<script>',
          artist: 'Artist',
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Song title contains invalid characters'),
        })
      );
    });
  });

  /* ============ APPROVE SONG HANDLER ============ */

  describe('handleApproveSong', () => {
    test('should approve song and broadcast', async () => {
      const callback = jest.fn();
      useOwnerSocket();

      await socketEvents.handleApproveSong(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
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
      useOwnerSocket();

      // Set song to PLAYED (terminal state)
      testSong.status = 'PLAYED';
      await testSong.save();

      // Try to approve
      await socketEvents.handleApproveSong(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
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
      useOwnerSocket();

      await socketEvents.handleRejectSong(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          reason: 'Explicit content',
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
      useOwnerSocket();

      // First play song
      testSong.status = 'PLAYING';
      await testSong.save();

      await socketEvents.handleSkipSong(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
          reason: 'Wrong song',
        },
        callback
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'SKIPPED',
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
      useOwnerSocket();

      // Approve song first
      testSong.status = 'APPROVED';
      testSong.recognitionMatch = {
        trackId: new mongoose.Types.ObjectId(),
        title: 'Test Song',
        artist: 'Test Artist',
        coverUrl: 'https://example.com/cover.jpg',
        score: 1,
        matchedOn: 'title_artist',
      };
      await testSong.save();

      await socketEvents.handleSendNow(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          songId: testSong._id.toString(),
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
            data: expect.objectContaining({
              recognitionMatch: expect.objectContaining({
                coverUrl: 'https://example.com/cover.jpg',
              }),
            }),
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
        socket,
        ioServer,
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
            event: 'votes_updated',
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
        socket,
        ioServer,
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
          error: expect.stringContaining('Vote value must be'),
        })
      );
    });
  });

  describe('handleRemoveVote', () => {
    test('should remove vote and broadcast', async () => {
      const callback = jest.fn();

      // First cast vote
      await socketEvents.handleCastVote(
        socket,
        ioServer,
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
        socket,
        ioServer,
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
      useOwnerSocket();

      await socketEvents.handleSetCooldown(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          participantId: testParticipant._id.toString(),
          durationMs: 5000,
          reason: 'Spam',
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

      const participant = await ParticipantModel.findById(testParticipant._id);
      expect(participant.cooldownUntil.getTime()).toBeGreaterThan(Date.now());
      expect(participant.cooldownReason).toBe('Spam');
    });
  });

  describe('handleKickParticipant', () => {
    test('should kick participant and broadcast', async () => {
      const callback = jest.fn();
      useOwnerSocket();

      await socketEvents.handleKickParticipant(
        socket,
        ioServer,
        {
          eventId: testEvent._id.toString(),
          participantId: testParticipant._id.toString(),
          reason: 'Inappropriate behavior',
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
      useOwnerSocket();

      await socketEvents.handleSetPremium(
        socket,
        ioServer,
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
    test('should tolerate missing acknowledgment callback', async () => {
      await expect(
        socketEvents.handleSuggestSong(
          socket,
          ioServer,
          {
            eventId: 'invalid',
            participantId: 'invalid',
            title: 'Song',
            artist: 'Artist',
          },
          undefined,
        ),
      ).resolves.toBeUndefined();

      expect(socket.emit).not.toHaveBeenCalled();
    });

    test('should emit socket error on invalid data', async () => {
      const callback = jest.fn();

      await socketEvents.handleApproveSong(
        socket,
        ioServer,
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
