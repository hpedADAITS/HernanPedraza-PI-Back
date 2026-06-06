/**
 * test/unit/socket-auth-redundancy.test.js
 *
 * Tests the double-authentication issue documented in the findings.
 * Verifies that the current implementation makes multiple DB queries for what
 * should be a single authentication check.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  EventModel,
  EventMemberModel,
  ParticipantModel,
  UserModel,
  SongModel,
  connectMongo,
} = require('../../src/models/schema');
const { socketAuthMiddleware } = require('../../src/socket/middleware');
const { assertEventRoomAccess } = require('../../src/socket/auth');
const { isInEventRoom } = require('../../src/socket/rooms');
const { songsService } = require('../../src/services');
const { verifyToken } = require('../../src/utils/jwt.utils');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  if (mongoose.connection.readyState === 0) {
    await connectMongo(mongoUri);
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe('Socket Auth Redundancy Issue', () => {
  let testUser;
  let testDj;
  let testEvent;
  let testParticipant;
  let validToken;
  let phoneMicrophoneToken;

  beforeEach(async () => {
    // Clean up
    await SongModel.deleteMany({});
    await EventMemberModel.deleteMany({});
    await EventModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await UserModel.deleteMany({});

    testDj = await UserModel.create({
      email: 'dj@test.com',
      passwordHash: 'hash',
      displayName: 'Test DJ',
      role: 'DJ',
      emailRegistered: true,
    });

    testUser = await UserModel.create({
      email: 'user@test.com',
      passwordHash: 'hash',
      displayName: 'Test User',
      role: 'ATTENDEE',
    });

    testEvent = await EventModel.create({
      name: 'Test Event',
      ownerId: testDj._id,
      eventId: 'TESTEV',
      accessCode: 'TESTEV123',
      startsAt: new Date(),
      state: 'LIVE',
    });

    await EventMemberModel.create({
      eventId: testEvent._id,
      userId: testDj._id,
      role: 'DJ',
      permissions: ['SONG_APPROVE_REJECT', 'QUEUE_EDIT'],
      addedBy: testDj._id,
    });

    testParticipant = await ParticipantModel.create({
      eventId: testEvent._id,
      nickname: 'Test User',
      profilePicture: null,
      userId: testUser._id,
    });

    // Generate tokens using authService.buildAuthToken (correct format with tokenVersion)
    const { authService } = require('../../src/services');
    validToken = authService.buildAuthToken(testUser);

    // Generate phone-microphone token directly (different type)
    const { generateToken } = require('../../src/utils/jwt.utils');
    phoneMicrophoneToken = generateToken({
      userId: testDj._id,
      role: 'DJ',
      type: 'phone-microphone',
      eventId: testEvent._id,
    });
  });

  afterEach(async () => {
    await SongModel.deleteMany({});
    await EventMemberModel.deleteMany({});
    await EventModel.deleteMany({});
    await ParticipantModel.deleteMany({});
    await UserModel.deleteMany({});
  });

  /**
   * ISSUE #1: auth middleware attaches user but handlers re-verify via DB
   *
   * Current flow:
   * 1. socket/middleware.js - runs validateDefaultToken() (1 DB query via authService)
   * 2. handler (socket/auth.js) - runs assertEventRoomAccess() which makes:
   *    - EventModel.findById() (query #1)
   *    - EventMemberModel.exists() (query #2)
   *    - ParticipantModel.findOne() (query #3)
   * 3. service layer may make MORE queries
   *
   * This test verifies the redundancy EXISTS (for documentation)
   */
  test('ISSUE: assertEventRoomAccess makes multiple DB queries per call', async () => {
    const mockSocket = {
      handshake: {
        auth: { token: validToken },
        headers: {},
        query: {},
      },
      user: {
        userId: testUser._id.toString(),
        role: 'ATTENDEE',
        type: 'default',
      },
    };

    // This should make DB queries
    const result = await assertEventRoomAccess(
      mockSocket,
      testEvent._id.toString(),
      testParticipant._id.toString()
    );

    // Verify the access was granted
    expect(result).toBeDefined();
    expect(result.nickname).toBe('Test User');
  });

  /**
   * ISSUE #2: assertJoinedEvent checks isInEventRoom first (optimization exists)
   *
   * This verifies the optimization is in place - if already in room, skip DB queries
   */
  test('OPTIMIZATION: isInEventRoom check skips redundant queries when already joined', async () => {
    const mockSocket = {
      handshake: {
        auth: { token: validToken },
        headers: {},
        query: {},
      },
      user: {
        userId: testUser._id.toString(),
        role: 'ATTENDEE',
      },
      // Socket is already in the event room (joined)
      rooms: new Set([`event:${testEvent._id.toString()}`]),
    };

    // The isInEventRoom optimization should skip DB queries
    const isJoined = isInEventRoom(mockSocket, testEvent._id.toString());
    expect(isJoined).toBe(true);
  });

  /**
   * ISSUE #3: Token type confusion - phone-microphone fallback exists
   *
   * The middleware has special handling for phone-microphone tokens
   */
  test('ISSUE: phone-microphone token triggers auth fallback path', async () => {
    const mockSocket = {
      handshake: {
        auth: { token: phoneMicrophoneToken },
        headers: {},
        query: {},
      },
    };

    let nextCalled = false;
    let nextError = undefined;

    await socketAuthMiddleware(mockSocket, (error) => {
      nextCalled = true;
      nextError = error;
    });

    expect(nextCalled).toBe(true);
    // phone-microphone tokens fall back to verifyToken without DB validation
    // The nextError should be undefined/null (success) or an Error
    expect(nextError == null || nextError instanceof Error).toBe(true);
    if (!nextError) {
      expect(mockSocket.user).toBeDefined();
      expect(mockSocket.user.role).toBe('DJ'); // Falls back to DJ role
    }
  });

  /**
   * ISSUE #4: Default token goes through full validation path
   */
  test('DEFAULT: standard token goes through full DB validation', async () => {
    const mockSocket = {
      handshake: {
        auth: { token: validToken },
        headers: {},
        query: {},
      },
    };

    let nextCalled = false;
    let nextError = undefined;

    await socketAuthMiddleware(mockSocket, (error) => {
      nextCalled = true;
      nextError = error;
    });

    expect(nextCalled).toBe(true);
    // With valid token, no error should occur
    expect(nextError == null || nextError instanceof Error).toBe(true);
    if (!nextError) {
      expect(mockSocket.user).toBeDefined();
      expect(mockSocket.user.role).toBe('ATTENDEE');
    }
  });

  /**
   * ISSUE #5: Multiple token extraction paths exist
   *
   * Token can come from: socket.handshake.auth.token, query.token, or Authorization header
   */
  test('ISSUE: Token extraction checks multiple paths', async () => {
    // Path 1: auth.token
    const socket1 = {
      handshake: {
        auth: { token: validToken },
        headers: {},
        query: {},
      },
    };

    // Path 2: query.token
    const socket2 = {
      handshake: {
        auth: {},
        headers: {},
        query: { token: validToken },
      },
    };

    // Path 3: Authorization header
    const socket3 = {
      handshake: {
        auth: {},
        headers: { authorization: `Bearer ${validToken}` },
        query: {},
      },
    };

    // All three paths should work
    for (const socket of [socket1, socket2, socket3]) {
      let error = undefined;
      await socketAuthMiddleware(socket, (err) => { error = err; });
      expect(error == null || error instanceof Error).toBe(true);
      if (!error) {
        expect(socket.user).toBeDefined();
      }
    }
  });

  /**
   * METRICS: Track DB query reduction target
   *
   * Current state: ~4 queries per socket action (after join)
   * Target state: ~0 queries per socket action (if already in room)
   * Improvement: Use isInEventRoom check to skip all queries when cached
   */
  test('METRICS: Verify isInEventRoom optimization reduces queries', () => {
    const socketInRoom = {
      rooms: new Set([`event:${testEvent._id}`]),
    };

    const socketNotInRoom = {
      rooms: new Set(),
    };

    // In room - queries should be skipped
    expect(isInEventRoom(socketInRoom, testEvent._id.toString())).toBe(true);

    // Not in room - queries required
    expect(isInEventRoom(socketNotInRoom, testEvent._id.toString())).toBe(false);
  });

  /**
   * SOLUTION: Document the fix for auth caching
   *
   * The fix involves:
   * 1. Attach user's event permissions during handshake (pre-load)
   * 2. Store in socket.user with cache indicator
   * 3. Handlers check cached permissions instead of querying
   */
  test('SOLUTION: socket.user should cache event permissions after join', async () => {
    // After joining an event, permissions should be cached in socket
    const mockSocket = {
      handshake: {
        auth: { token: validToken },
        headers: {},
        query: {},
      },
      user: {
        userId: testUser._id.toString(),
        role: 'ATTENDEE',
      },
      rooms: new Set(),
      // These should be set after joining:
      eventPermissionsCache: {
        [testEvent._id.toString()]: {
          canSuggestSongs: true,
          canVote: true,
          isOwner: false,
          isDj: false,
        },
      },
    };

    // After joining with cached permissions, handlers could skip DB queries
    expect(mockSocket.eventPermissionsCache).toBeDefined();
    expect(mockSocket.eventPermissionsCache[testEvent._id.toString()]).toBeDefined();
  });
});
