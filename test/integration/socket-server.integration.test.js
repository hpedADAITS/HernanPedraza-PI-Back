process.env.DEBUG_EMAIL = 'true';
process.env.DEBUG_MODE = 'true';
process.env.SOCKET_AUTH_DISABLED = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const app = require('../../src/app');
const { initSocketIO } = require('../../src/loaders/socket');
const { io: Client } = require('../../../Front/node_modules/socket.io-client');
const {
  EventMemberModel,
  EventModel,
  ParticipantModel,
  SongModel,
  UserModel,
  VoteModel,
} = require('../../src/models');

function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const onEvent = (data) => {
      clearTimeout(timer);
      resolve(data);
    };

    socket.once(event, onEvent);
  });
}

function emitAck(socket, event, payload, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event} ack`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });
const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function registerUser(overrides = {}) {
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `socket-${seed}@example.com`,
      password: 'StrongPass123!',
      displayName: 'Socket User',
      role: 'ATTENDEE',
      ...overrides,
    })
    .expect(201);
}

async function createVerifiedDj(overrides = {}) {
  const res = await registerUser({ role: 'DJ', displayName: 'Socket DJ', ...overrides });
  await request(app).get(`/api/v1/auth/verify-email/${res.body.data.emailVerificationToken}`).expect(200);
  return { token: res.body.data.token, user: res.body.data.user };
}

async function createEvent(token) {
  const res = await request(app)
    .post('/api/v1/events')
    .set(authHeader(token))
    .send({ name: 'Socket Event', description: 'Socket coverage', startsAt: futureDate() })
    .expect(201);
  return res.body.data.event;
}

async function joinEvent(eventId, token, nickname) {
  const res = await request(app)
    .post(`/api/v1/participants/${eventId}/join`)
    .set(authHeader(token))
    .send({ nickname })
    .expect(201);
  return res.body.data.participant;
}

describe('Socket.IO server integration', () => {
  let io;
  let httpServer;
  let mongoServer;
  let serverUrl;
  let clients = [];

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    ({ io, httpServer } = initSocketIO(app));
    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    clients = [];
    await Promise.all([
      EventMemberModel.deleteMany({}),
      EventModel.deleteMany({}),
      ParticipantModel.deleteMany({}),
      SongModel.deleteMany({}),
      UserModel.deleteMany({}),
      VoteModel.deleteMany({}),
    ]);
  });

  afterEach(() => {
    clients.forEach((client) => {
      if (client.connected) client.disconnect();
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => io.close(resolve));
    await mongoose.disconnect();
    await mongoServer.stop();
    delete process.env.SOCKET_AUTH_DISABLED;
  });

  async function connectClient() {
    const client = Client(serverUrl, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    clients.push(client);
    await waitForEvent(client, 'connect');
    return client;
  }

  test('broadcasts join_event and leave_event to clients in the event room', async () => {
    const dj = await createVerifiedDj();
    const attendee = await registerUser({ displayName: 'Socket Guest' });
    const event = await createEvent(dj.token);
    const participant = await joinEvent(event.id, attendee.body.data.token, 'Listener');
    const broadcasterParticipant = await joinEvent(event.id, attendee.body.data.token, 'Broadcaster');
    const broadcaster = await connectClient();
    const listener = await connectClient();

    const listenerJoined = waitForEvent(listener, 'participant_joined');
    listener.emit('join_event', {
      eventId: event.id,
      participantId: participant._id,
      nickname: 'Listener',
    });
    await listenerJoined;

    const broadcastReceived = waitForEvent(listener, 'participant_joined');
    broadcaster.emit('join_event', {
      eventId: event.id,
      participantId: broadcasterParticipant._id,
      nickname: 'Broadcaster',
    });
    await expect(broadcastReceived).resolves.toEqual(
      expect.objectContaining({
        participantId: broadcasterParticipant._id,
        nickname: 'Broadcaster',
        joinedAt: expect.any(String),
      }),
    );

    const leftReceived = waitForEvent(listener, 'participant_left');
    broadcaster.emit('leave_event', {
      eventId: event.id,
      participantId: broadcasterParticipant._id,
    });
    await expect(leftReceived).resolves.toEqual(
      expect.objectContaining({ participantId: broadcasterParticipant._id }),
    );
  });

  test('exercises song, vote, queue and participant-management socket commands against Mongo data', async () => {
    const dj = await createVerifiedDj();
    const attendee = await registerUser({ displayName: 'Socket Voter' });
    const event = await createEvent(dj.token);
    const participant = await joinEvent(event.id, attendee.body.data.token, 'Voter');
    const client = await connectClient();
    const listener = await connectClient();

    listener.emit('join_event', { eventId: event.id, participantId: participant._id, nickname: 'Voter' });
    await waitForEvent(listener, 'participant_joined');

    const suggestedEvent = waitForEvent(listener, 'song_suggested');
    const suggestedAck = await emitAck(client, 'suggest_song', {
      eventId: event.id,
      participantId: participant._id,
      title: 'Socket Song',
      artist: 'Socket Artist',
      totalDuration: 123,
      userId: attendee.body.data.user.id,
    });
    expect(suggestedAck).toMatchObject({ success: true, data: { title: 'Socket Song' } });
    const suggested = await suggestedEvent;
    const songId = suggested.songId.toString();

    const approvedEvent = waitForEvent(listener, 'song_approved');
    const queueAfterApprove = waitForEvent(listener, 'queue_updated');
    await expect(
      emitAck(client, 'approve_song', { eventId: event.id, songId, userId: dj.user.id }),
    ).resolves.toMatchObject({ success: true, data: { status: 'APPROVED' } });
    await expect(approvedEvent).resolves.toMatchObject({ songId: expect.anything(), status: 'APPROVED' });
    await expect(queueAfterApprove).resolves.toMatchObject({ eventId: event.id, queue: expect.any(Array) });

    const voteEvent = waitForEvent(listener, 'votes_updated');
    await expect(
      emitAck(client, 'cast_vote', {
        eventId: event.id,
        songId,
        participantId: participant._id,
        value: 1,
        userId: attendee.body.data.user.id,
      }),
    ).resolves.toMatchObject({ success: true, data: { value: 1 } });
    await expect(voteEvent).resolves.toMatchObject({ songId, participantId: participant._id, value: 1 });

    const voteRemoved = waitForEvent(listener, 'vote_removed');
    await expect(
      emitAck(client, 'remove_vote', {
        eventId: event.id,
        songId,
        participantId: participant._id,
        userId: attendee.body.data.user.id,
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(voteRemoved).resolves.toMatchObject({ songId, participantId: participant._id });

    const nowPlaying = waitForEvent(listener, 'song_now_playing');
    await expect(
      emitAck(client, 'send_now', { eventId: event.id, songId, userId: dj.user.id }),
    ).resolves.toMatchObject({ success: true, data: { status: 'PLAYING' } });
    await expect(nowPlaying).resolves.toMatchObject({ songId: expect.anything(), status: 'PLAYING' });

    const skipped = waitForEvent(listener, 'song_skipped');
    await expect(
      emitAck(client, 'skip_song', {
        eventId: event.id,
        songId,
        reason: 'Socket skip',
        userId: dj.user.id,
      }),
    ).resolves.toMatchObject({ success: true, data: { status: 'SKIPPED' } });
    await expect(skipped).resolves.toMatchObject({ songId: expect.anything(), status: 'SKIPPED' });

    const rejectedSuggestion = await emitAck(client, 'suggest_song', {
      eventId: event.id,
      participantId: participant._id,
      title: 'Reject Via Socket',
      artist: 'Socket Artist',
      userId: attendee.body.data.user.id,
    });
    const rejected = waitForEvent(listener, 'song_rejected');
    await expect(
      emitAck(client, 'reject_song', {
        eventId: event.id,
        songId: rejectedSuggestion.data.id,
        reason: 'No thanks',
        userId: dj.user.id,
      }),
    ).resolves.toMatchObject({ success: true, data: { status: 'REJECTED' } });
    await expect(rejected).resolves.toMatchObject({ status: 'REJECTED', reason: 'No thanks' });

    const cooldown = waitForEvent(listener, 'participant_cooldown');
    await expect(
      emitAck(client, 'set_cooldown', {
        eventId: event.id,
        participantId: participant._id,
        durationMs: 30_000,
        reason: 'Slow down',
        userId: dj.user.id,
      }),
    ).resolves.toMatchObject({ success: true, data: { cooldownReason: 'Slow down' } });
    await expect(cooldown).resolves.toMatchObject({ participantId: participant._id, reason: 'Slow down' });

    const premium = waitForEvent(listener, 'participant_premium_updated');
    await expect(
      emitAck(client, 'set_premium', {
        eventId: event.id,
        participantId: participant._id,
        isPremium: true,
        userId: dj.user.id,
      }),
    ).resolves.toMatchObject({ success: true, data: { isPremium: true } });
    await expect(premium).resolves.toMatchObject({ participantId: participant._id, isPremium: true });

    const kicked = waitForEvent(listener, 'participant_kicked');
    await expect(
      emitAck(client, 'kick_participant', {
        eventId: event.id,
        participantId: participant._id,
        reason: 'Socket kick',
        userId: dj.user.id,
      }),
    ).resolves.toMatchObject({ success: true, data: { leftAt: expect.anything() } });
    await expect(kicked).resolves.toMatchObject({ participantId: participant._id, reason: 'Socket kick' });

    const banTarget = await joinEvent(event.id, attendee.body.data.token, 'Ban Target');
    const banned = waitForEvent(listener, 'participant_banned');
    await expect(
      emitAck(client, 'ban_participant', {
        eventId: event.id,
        participantId: banTarget._id,
        reason: 'Socket ban',
        userId: dj.user.id,
      }),
    ).resolves.toMatchObject({ success: true, data: { isBanned: true } });
    await expect(banned).resolves.toMatchObject({ participantId: banTarget._id, reason: 'Socket ban' });

    await expect(SongModel.findById(songId).lean()).resolves.toMatchObject({ status: 'SKIPPED' });
  });

  test('emits a real socket error for invalid join_event payloads', async () => {
    const client = await connectClient();

    const errorReceived = waitForEvent(client, 'error');
    client.emit('join_event', {
      eventId: 'invalid-event-id',
    });

    await expect(errorReceived).resolves.toEqual({
      message: 'Error joining event',
    });
  });
});
