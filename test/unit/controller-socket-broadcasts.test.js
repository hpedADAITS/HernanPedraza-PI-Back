const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const eventsController = require('../../src/controllers/events.controller');
const songsController = require('../../src/controllers/songs.controller');
const votesController = require('../../src/controllers/votes.controller');
const {
  EventModel,
  ParticipantModel,
  SongModel,
  UserModel,
  VoteModel,
} = require('../../src/models');

let mongoServer;

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function createIO() {
  const emitted = [];

  return {
    emitted,
    io: {
      to: jest.fn((room) => ({
        emit: jest.fn((event, payload) => {
          emitted.push({ room, event, payload });
        }),
      })),
    },
  };
}

async function createEventFlow() {
  const owner = await UserModel.create({
    email: `dj-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    passwordHash: 'hashed-password',
    displayName: 'DJ Flow',
    role: 'DJ',
  });
  const event = await EventModel.create({
    name: 'Controller Flow',
    ownerId: owner._id,
    eventId: `EV${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    accessCode: `AC${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    startsAt: new Date(),
    state: 'LIVE',
  });
  const participant = await ParticipantModel.create({
    eventId: event._id,
    nickname: 'Bailey',
    userId: owner._id,
  });

  return { owner, event, participant };
}

async function createSong(event, participant, overrides = {}) {
  return SongModel.create({
    eventId: event._id,
    requestedBy: participant._id,
    title: 'Track',
    artist: 'Artist',
    status: 'PENDING',
    sortKey: `${Date.now()}_${Math.random()}`,
    ...overrides,
  });
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    EventModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    SongModel.deleteMany({}),
    UserModel.deleteMany({}),
    VoteModel.deleteMany({}),
  ]);
  jest.clearAllMocks();
});

describe('REST controller Socket.IO broadcasts', () => {
  test('regenerateAccessCode persists through service and emits event/access code updates', async () => {
    const { owner, event } = await createEventFlow();
    const { io, emitted } = createIO();
    const res = createResponse();
    const next = jest.fn();
    eventsController.setIO(io);

    await eventsController.regenerateAccessCode(
      {
        params: { eventId: event._id.toString() },
        user: { userId: owner._id.toString() },
      },
      res,
      next,
    );

    const stored = await EventModel.findById(event._id).lean();

    expect(next).not.toHaveBeenCalled();
    expect(stored.accessCode).not.toBe(event.accessCode);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          room: `event:${event._id}`,
          event: 'event_updated',
          payload: expect.objectContaining({ eventId: event._id.toString() }),
        }),
        expect.objectContaining({
          room: `event:${event._id}`,
          event: 'access_code_updated',
          payload: expect.objectContaining({
            eventId: event._id.toString(),
            accessCode: stored.accessCode,
          }),
        }),
      ]),
    );
  });

  test('approveSong persists the approved song and emits the canonical queue snapshot', async () => {
    const { owner, event, participant } = await createEventFlow();
    const song = await createSong(event, participant, { voteScore: 3, voteCount: 3 });
    const { io, emitted } = createIO();
    const res = createResponse();
    const next = jest.fn();
    songsController.setIO(io);

    await songsController.approveSong(
      {
        params: { eventId: event._id.toString(), songId: song._id.toString() },
        user: { userId: owner._id.toString() },
      },
      res,
      next,
    );

    const stored = await SongModel.findById(song._id).lean();

    expect(next).not.toHaveBeenCalled();
    expect(stored.status).toBe('APPROVED');
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'song_approved',
          payload: expect.objectContaining({
            eventId: event._id.toString(),
            songId: song._id,
            title: 'Track',
            status: 'APPROVED',
          }),
        }),
        expect.objectContaining({
          event: 'queue_updated',
          payload: expect.objectContaining({
            eventId: event._id.toString(),
            queue: expect.arrayContaining([
              expect.objectContaining({ _id: song._id, status: 'APPROVED' }),
            ]),
          }),
        }),
      ]),
    );
  });

  test('castVote persists the vote and emits queue updates using saved song stats', async () => {
    const { event, participant } = await createEventFlow();
    const song = await createSong(event, participant);
    const { io, emitted } = createIO();
    const res = createResponse();
    const next = jest.fn();
    votesController.setIO(io);

    await votesController.castVote(
      {
        body: {
          songId: song._id.toString(),
          participantId: participant._id.toString(),
          value: 1,
        },
        user: { userId: participant.userId.toString(), role: 'ATTENDEE' },
      },
      res,
      next,
    );

    const storedSong = await SongModel.findById(song._id).lean();
    const storedVote = await VoteModel.findOne({
      songId: song._id,
      participantId: participant._id,
    }).lean();

    expect(next).not.toHaveBeenCalled();
    expect(storedVote.value).toBe(1);
    expect(storedSong.voteScore).toBe(1);
    expect(storedSong.voteCount).toBe(1);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'votes_updated',
          payload: expect.objectContaining({
            eventId: event._id.toString(),
            songId: song._id.toString(),
            participantId: participant._id.toString(),
            value: 1,
            voteScore: 1,
            voteCount: 1,
          }),
        }),
        expect.objectContaining({
          event: 'queue_updated',
          payload: expect.objectContaining({ eventId: event._id.toString() }),
        }),
      ]),
    );
  });
});
