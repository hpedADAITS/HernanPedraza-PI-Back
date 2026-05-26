const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const { participantsController } = require('../../src/controllers');
const cooldownCache = require('../../src/utils/cooldown-cache');
const {
  EventMemberModel,
  EventModel,
  ParticipantModel,
  SongModel,
  UserModel,
  VoteModel,
} = require('../../src/models');

let mongoServer;

const DJ_USER = {
  email: 'dj.queue@example.com',
  password: 'StrongPass123!',
  displayName: 'DJ Queue',
  role: 'DJ',
};

const ATTENDEE_USER = {
  email: 'guest.queue@example.com',
  password: 'StrongPass123!',
  displayName: 'Guest Queue',
  role: 'ATTENDEE',
};

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

const register = (user) => request(app).post('/api/v1/auth/register').send(user);

const createConfirmedDj = async () => {
  const res = await register(DJ_USER).expect(201);
  await UserModel.findOneAndUpdate(
    { email: DJ_USER.email },
    {
      emailRegistered: true,
      emailRegisteredAt: new Date(),
      profilePicture: 'dj-avatar-1',
    },
  );
  return {
    token: res.body.data.token,
    userId: res.body.data.user.id,
  };
};

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
    EventMemberModel.deleteMany({}),
    EventModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    SongModel.deleteMany({}),
    UserModel.deleteMany({}),
    VoteModel.deleteMany({}),
  ]);
  participantsController.setIO(null);
});

describe('Event, participant, song and vote integration flow', () => {
  test('runs the main live-event queue flow end-to-end', async () => {
    const dj = await createConfirmedDj();
    const attendee = await register(ATTENDEE_USER).expect(201);
    const attendeeToken = attendee.body.data.token;

    const eventRes = await request(app)
      .post('/api/v1/events')
      .set(authHeader(dj.token))
      .send({
        name: 'Friday Requests',
        description: 'Requests for the main room',
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);

    const event = eventRes.body.data.event;
    expect(event).toMatchObject({
      name: 'Friday Requests',
      description: 'Requests for the main room',
      state: 'DRAFT',
    });
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.accessCode).toEqual(expect.any(String));

    await request(app)
      .post(`/api/v1/events/${event.id}/start`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.event.state).toBe('LIVE');
      });

    await request(app)
      .get(`/api/v1/events/access/${event.accessCode.toLowerCase()}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.event.id).toBe(event.id);
        expect(res.body.data.event.ownerId.email).toBeUndefined();
        expect(res.body.data.event.ownerId.profilePicture).toBe('dj-avatar-1');
      });

    const joinRes = await request(app)
      .post(`/api/v1/participants/${event.id}/join`)
      .set(authHeader(attendeeToken))
      .send({ nickname: 'Ada', profilePicture: 'avatar-1' })
      .expect(201);

    const participant = joinRes.body.data.participant;
    expect(participant).toMatchObject({
      nickname: 'Ada',
      profilePicture: 'avatar-1',
      isPremium: false,
    });
    expect(participant).not.toHaveProperty('leftAt');

    await request(app)
      .post(`/api/v1/participants/${event.id}/join`)
      .set(authHeader(attendeeToken))
      .send({ nickname: ' ada ' })
      .expect(400);

    const suggestion = await request(app)
      .post(`/api/v1/songs/${event.id}/suggest`)
      .set(authHeader(attendeeToken))
      .send({
        participantId: participant._id,
        title: 'Digital Love',
        artist: 'Daft Punk',
      })
      .expect(201);

    const song = suggestion.body.data.song;
    expect(song).toMatchObject({
      title: 'Digital Love',
      artist: 'Daft Punk',
      status: 'PENDING',
      voteScore: 0,
      voteCount: 0,
    });

    await request(app)
      .get(`/api/v1/songs/${event.id}/pending`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.pending).toHaveLength(1);
        expect(res.body.data.pending[0].id).toBe(song.id);
      });

    await request(app)
      .post(`/api/v1/songs/${event.id}/${song.id}/approve`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.song.status).toBe('APPROVED');
      });

    await request(app)
      .post('/api/v1/votes')
      .set(authHeader(attendeeToken))
      .send({ songId: song.id, participantId: participant._id, value: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.vote.value).toBe(1);
      });

    await request(app)
      .post('/api/v1/votes')
      .set(authHeader(attendeeToken))
      .send({ songId: song.id, participantId: participant._id, value: -1 })
      .expect(201);

    await request(app)
      .get(`/api/v1/votes/${song.id}/${participant._id}`)
      .set(authHeader(attendeeToken))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.vote.value).toBe(-1);
      });

    await request(app)
      .get(`/api/v1/votes/${event.id}/stats`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.total_songs).toBe(1);
        expect(res.body.data.top_voted[0]).toMatchObject({
          title: 'Digital Love',
          artist: 'Daft Punk',
          votes: -1,
          count: 1,
        });
      });

    await request(app)
      .post(`/api/v1/songs/${event.id}/${song.id}/send-now`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.song.status).toBe('PLAYING');
      });

    await request(app)
      .get(`/api/v1/songs/${event.id}/queue`)
      .set(authHeader(attendeeToken))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.queue).toHaveLength(1);
        expect(res.body.data.queue[0].status).toBe('PLAYING');
      });

    await request(app)
      .delete(`/api/v1/votes/${song.id}/${participant._id}`)
      .set(authHeader(attendeeToken))
      .expect(200);

    await request(app)
      .post(`/api/v1/participants/${participant._id}/leave`)
      .set(authHeader(attendeeToken))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.leftAt).toEqual(expect.any(String));
      });

    const storedSong = await SongModel.findById(song.id);
    expect(storedSong.status).toBe('PLAYING');
    expect(storedSong.voteScore).toBe(0);
    expect(storedSong.voteCount).toBe(0);
  });

  test('requires authentication for queue-changing endpoints', async () => {
    await request(app).post('/api/v1/events').send({}).expect(401);
    await request(app).post('/api/v1/votes').send({}).expect(401);
  });

  test('kicks and cooldowns attendees with realtime payloads and blocks further actions', async () => {
    const dj = await createConfirmedDj();
    const attendee = await register(ATTENDEE_USER).expect(201);
    const attendeeToken = attendee.body.data.token;
    const ioEmit = jest.fn();
    const ioTo = jest.fn(() => ({ emit: ioEmit }));
    participantsController.setIO({ to: ioTo });

    const eventRes = await request(app)
      .post('/api/v1/events')
      .set(authHeader(dj.token))
      .send({
        name: 'Admin Actions',
        description: 'DJ moderation flow',
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);

    const event = eventRes.body.data.event;

    const joinRes = await request(app)
      .post(`/api/v1/participants/${event.id}/join`)
      .set(authHeader(attendeeToken))
      .send({ nickname: 'Ada' })
      .expect(201);

    const participant = joinRes.body.data.participant;

    await request(app)
      .post(`/api/v1/participants/${participant._id}/cooldown`)
      .set(authHeader(dj.token))
      .send({ durationMs: 300000, reason: 'Slow down' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.cooldownUntil).toEqual(
          expect.any(String),
        );
      });

    expect(ioTo).toHaveBeenCalledWith(`event:${event.id}`);
    expect(ioEmit).toHaveBeenCalledWith(
      'participant_cooldown',
      expect.objectContaining({
        participantId: participant._id,
        reason: 'Slow down',
        cooldownUntil: expect.any(String),
      }),
    );

    await request(app)
      .post(`/api/v1/songs/${event.id}/suggest`)
      .set(authHeader(attendeeToken))
      .send({
        participantId: participant._id,
        title: 'Blocked Song',
        artist: 'The Queue',
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.message).toContain('Participant is on cooldown');
      });

    cooldownCache.clearAll();

    const suggestion = await request(app)
      .post(`/api/v1/songs/${event.id}/suggest`)
      .set(authHeader(attendeeToken))
      .send({
        participantId: participant._id,
        title: 'Digital Love',
        artist: 'Daft Punk',
      })
      .expect(201);

    const song = suggestion.body.data.song;

    await request(app)
      .post(`/api/v1/participants/${participant._id}/cooldown`)
      .set(authHeader(dj.token))
      .send({ durationMs: 300000, reason: 'Pause voting' })
      .expect(200);

    await request(app)
      .post(`/api/v1/votes`)
      .set(authHeader(attendeeToken))
      .send({ songId: song.id, participantId: participant._id, value: 1 })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.message).toContain('Participant is on cooldown');
      });

    cooldownCache.clearAll();

    await request(app)
      .post(`/api/v1/votes`)
      .set(authHeader(attendeeToken))
      .send({ songId: song.id, participantId: participant._id, value: 1 })
      .expect(201);

    await request(app)
      .post(`/api/v1/participants/${participant._id}/kick`)
      .set(authHeader(dj.token))
      .send({ reason: 'Kicked by DJ' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.leftAt).toEqual(expect.any(String));
      });

    expect(ioEmit).toHaveBeenCalledWith(
      'participant_kicked',
      expect.objectContaining({
        participantId: participant._id,
        reason: 'Kicked by DJ',
        kickedAt: expect.any(String),
      }),
    );

    await request(app)
      .post(`/api/v1/songs/${event.id}/suggest`)
      .set(authHeader(attendeeToken))
      .send({
        participantId: participant._id,
        title: 'After Kick',
        artist: 'No Entry',
      })
      .expect(403)
      .expect((res) => {
        expect(res.body.error.message).toContain('kicked');
      });

    await request(app)
      .post('/api/v1/votes')
      .set(authHeader(attendeeToken))
      .send({ songId: song.id, participantId: participant._id, value: -1 })
      .expect(403)
      .expect((res) => {
        expect(res.body.error.message).toContain('kicked');
      });

    await request(app)
      .delete(`/api/v1/votes/${song.id}/${participant._id}`)
      .set(authHeader(attendeeToken))
      .expect(403)
      .expect((res) => {
        expect(res.body.error.message).toContain('kicked');
      });
  });

  test('rejects participant admin actions for users without DJ permission', async () => {
    const dj = await createConfirmedDj();
    const attendee = await register(ATTENDEE_USER).expect(201);
    const attendeeToken = attendee.body.data.token;
    const secondAttendee = await register({
      email: 'guest.second@example.com',
      password: 'StrongPass123!',
      displayName: 'Guest Two',
      role: 'ATTENDEE',
    }).expect(201);

    const eventRes = await request(app)
      .post('/api/v1/events')
      .set(authHeader(dj.token))
      .send({
        name: 'Permission Check',
        description: 'DJ moderation permissions',
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);

    const event = eventRes.body.data.event;

    const joinRes = await request(app)
      .post(`/api/v1/participants/${event.id}/join`)
      .set(authHeader(attendeeToken))
      .send({ nickname: 'Ada' })
      .expect(201);

    const participant = joinRes.body.data.participant;

    await request(app)
      .post(`/api/v1/participants/${participant._id}/kick`)
      .set(authHeader(secondAttendee.body.data.token))
      .send({ reason: 'Nope' })
      .expect(403);

    await request(app)
      .post(`/api/v1/participants/${participant._id}/cooldown`)
      .set(authHeader(secondAttendee.body.data.token))
      .send({ durationMs: 300000, reason: 'Nope' })
      .expect(403);
  });
});
