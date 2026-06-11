/**
 * test/integration/socket-events.integration.test.js
 *
 * Socket event broadcast tests with REAL callbacks
 * Tests the complete flow: handler -> broadcast
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  EventModel,
  ParticipantModel,
  SongModel,
  UserModel,
  connectMongo,
} = require('../../src/models/schema');
const events = require('../../src/socket/events');

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

beforeEach(async () => {
  await EventModel.deleteMany({});
  await ParticipantModel.deleteMany({});
  await SongModel.deleteMany({});
  await UserModel.deleteMany({});
});

describe('Socket event broadcasts', () => {
  test('join_event includes the participant profile picture', async () => {
    // Create test user
    const user = await UserModel.create({
      email: 'test@example.com',
      passwordHash: 'hashed-password',
      displayName: 'Ada',
      role: 'ATTENDEE',
    });

    // Create test event owned by a DJ
    const djUser = await UserModel.create({
      email: 'dj@example.com',
      passwordHash: 'hashed-password',
      displayName: 'DJ Test',
      role: 'DJ',
    });
    const event = await EventModel.create({
      name: 'Test Event',
      code: 'ABCDEF',
      ownerId: djUser._id,
      eventId: 'event-1',
      accessCode: 'ABCDEF',
      startsAt: new Date(),
    });

    // Create participant
    const participant = await ParticipantModel.create({
      eventId: event._id,
      userId: user._id,
      nickname: 'Ada',
      profilePicture: 'avatar-1',
    });

    const eventId = event._id.toString();
    const participantId = participant._id.toString();

    const socket = {
      id: 'socket-1',
      join: jest.fn(),
      emit: jest.fn(),
      rooms: new Set(),
      user: {
        userId: user._id.toString(),
        _id: user._id,
        role: 'ATTENDEE',
      },
    };
    const emit = jest.fn();
    const io = {
      to: jest.fn(() => ({ emit })),
    };

    await events.handleJoinEvent(socket, io, {
      eventId,
      participantId,
      nickname: 'Ada',
      profilePicture: 'avatar-1',
    });

    expect(socket.join).toHaveBeenCalledWith(`event:${eventId}`);
    expect(io.to).toHaveBeenCalledWith(`event:${eventId}`);
    expect(emit).toHaveBeenCalledWith(
      'participant_joined',
      expect.objectContaining({
        participantId,
        nickname: 'Ada',
        profilePicture: 'avatar-1',
      }),
    );
  });

  test('join_event sends the current queue to the joining attendee', async () => {
    const user = await UserModel.create({
      email: 'queue-listener@example.com',
      passwordHash: 'hashed-password',
      displayName: 'Queue Listener',
      role: 'ATTENDEE',
    });
    const djUser = await UserModel.create({
      email: 'queue-dj@example.com',
      passwordHash: 'hashed-password',
      displayName: 'Queue DJ',
      role: 'DJ',
    });
    const event = await EventModel.create({
      name: 'Queue Event',
      code: 'QUEUE1',
      ownerId: djUser._id,
      eventId: 'event-queue',
      accessCode: 'QUEUE1',
      startsAt: new Date(),
    });
    const participant = await ParticipantModel.create({
      eventId: event._id,
      userId: user._id,
      nickname: 'Queue Listener',
    });
    const queuedSong = await SongModel.create({
      eventId: event._id,
      requestedBy: participant._id,
      title: 'Queued Song',
      artist: 'Queued Artist',
      status: 'APPROVED',
      sortKey: 'queued-song',
    });

    const eventId = event._id.toString();
    const participantId = participant._id.toString();
    const socket = {
      id: 'socket-queue',
      join: jest.fn(),
      emit: jest.fn(),
      rooms: new Set(),
      user: {
        userId: user._id.toString(),
        _id: user._id,
        role: 'ATTENDEE',
      },
    };
    const io = {
      to: jest.fn(() => ({ emit: jest.fn() })),
    };

    await events.handleJoinEvent(socket, io, {
      eventId,
      participantId,
      nickname: 'Queue Listener',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'queue_updated',
      expect.objectContaining({
        eventId,
        queue: expect.arrayContaining([
          expect.objectContaining({
            _id: queuedSong._id,
            title: 'Queued Song',
            status: 'APPROVED',
          }),
        ]),
        timestamp: expect.any(String),
      }),
    );
  });
});
