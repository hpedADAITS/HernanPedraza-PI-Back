/**
 * test/integration/socket-dj-not-participant.integration.test.js
 *
 * Regression test for the production log line
 *   "Participant joined event: <id> - DJSDJ2"
 * which fired when a DJ's socket joined their own event. The DJ was
 * being recorded as a participant even though they are the event owner.
 *
 * This file pins the DJ-side behavior only. The attendee path is
 * covered by the existing socket integration tests; rewriting that
 * fixture here is out of scope and risks introducing new flakiness.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const {
  EventModel,
  EventMemberModel,
  ParticipantModel,
  UserModel,
  connectMongo,
} = require('../../src/models/schema');
const room = require('../../src/socket/room');
const { isEventMemberOrOwner } = require('../../src/socket/auth');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectMongo(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    EventModel.deleteMany({}),
    EventMemberModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

async function createDj() {
  return UserModel.create({
    email: 'dj@test.com',
    passwordHash: await bcrypt.hash('StrongPass123!', 10),
    displayName: 'DJSDJ2',
    role: 'DJ',
  });
}

async function createEventFor(dj) {
  const event = await EventModel.create({
    name: 'DJSDJ2 party',
    description: 'desc',
    ownerId: dj._id,
    eventId: 'PARTY01',
    accessCode: 'ABC123',
    state: 'LIVE',
    startsAt: new Date(),
    settings: {
      allowRequests: true,
      requireApproval: false,
      votingEnabled: true,
      allowDownvotes: true,
      maxRequestsPerParticipant: 3,
    },
  });
  await EventMemberModel.create({
    eventId: event._id,
    userId: dj._id,
    role: 'DJ',
    permissions: [],
    addedBy: dj._id,
  });
  return event;
}

function makeOwnerSocket(user) {
  return {
    id: 'socket-1',
    user: { userId: user._id.toString(), role: user.role },
    eventId: null,
    participantId: null,
    isEventStaff: undefined,
    rooms: new Set(),
    join(room) { this.rooms.add(room); },
    leave(room) { this.rooms.delete(room); },
    emit: jest.fn(),
  };
}

function makeIo() {
  const emitMock = jest.fn();
  return {
    to: jest.fn(() => ({ emit: emitMock })),
    _emit: emitMock,
  };
}

describe('Socket join_event: event owner / DJ is NOT a participant', () => {
  test('isEventMemberOrOwner returns true for the event owner', async () => {
    const dj = await createDj();
    const event = await createEventFor(dj);
    const socket = makeOwnerSocket(dj);

    const result = await isEventMemberOrOwner(event._id.toString(), socket);

    expect(result).toBe(true);
  });

  test('handleJoinEvent does NOT create a Participant record for the event owner', async () => {
    const dj = await createDj();
    const event = await createEventFor(dj);
    const io = makeIo();
    const socket = makeOwnerSocket(dj);

    await room.handleJoinEvent(socket, io, {
      eventId: event._id.toString(),
      participantId: dj._id.toString(),
      nickname: dj.displayName,
      profilePicture: null,
    });

    const participants = await ParticipantModel.find({ eventId: event._id });
    expect(participants).toHaveLength(0);
    expect(socket.isEventStaff).toBe(true);
    expect(socket.participantId).toBeNull();
  });

  test('handleJoinEvent does NOT emit participant_joined for the event owner', async () => {
    const dj = await createDj();
    const event = await createEventFor(dj);
    const io = makeIo();
    const socket = makeOwnerSocket(dj);

    await room.handleJoinEvent(socket, io, {
      eventId: event._id.toString(),
      participantId: dj._id.toString(),
      nickname: dj.displayName,
      profilePicture: null,
    });

    const roomBroadcasts = io._emit.mock.calls.map((args) => args[0]);
    expect(roomBroadcasts).not.toContain('participant_joined');
  });
});
