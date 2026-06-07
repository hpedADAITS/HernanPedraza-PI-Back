process.env.DEBUG_EMAIL = 'true';
process.env.DEBUG_MODE = 'true';

/* Avoid hitting the live MusicBrainz API during functional tests. Network
 * lookups make the suite hang and return real-world matches that override the
 * local fingerprint behaviour these tests assert on. */
jest.mock('../../src/services/musicbrainz.service', () => ({
  findRecordingMatch: jest.fn().mockResolvedValue(null),
  findRecordingMatches: jest.fn().mockResolvedValue([]),
  lookupRecordingSummary: jest.fn().mockResolvedValue(null),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const {
  AudioTrackModel,
  EventMemberModel,
  EventModel,
  ParticipantModel,
  SongModel,
  UserModel,
  VoteModel,
} = require('../../src/models');

let mongoServer;

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });
const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function registerUser(overrides = {}) {
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `user-${seed}@example.com`,
      password: 'StrongPass123!',
      displayName: 'Functional User',
      role: 'ATTENDEE',
      ...overrides,
    })
    .expect(201);
}

async function createVerifiedDj(overrides = {}) {
  const res = await registerUser({
    displayName: 'Functional DJ',
    role: 'DJ',
    ...overrides,
  });
  await request(app)
    .get(`/api/v1/auth/verify-email/${res.body.data.emailVerificationToken}`)
    .expect(200);

  return {
    token: res.body.data.token,
    user: res.body.data.user,
  };
}

async function createEvent(token, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/events')
    .set(authHeader(token))
    .send({
      name: 'Functional Event',
      description: 'Functional coverage event',
      startsAt: futureDate(),
      ...overrides,
    })
    .expect(201);

  return res.body.data.event;
}

async function joinEvent(eventId, token, nickname) {
  const res = await request(app)
    .post(`/api/v1/participants/${eventId}/join`)
    .set(authHeader(token))
    .send({ nickname, profilePicture: `${nickname}-avatar` })
    .expect(201);

  return res.body.data.participant;
}

async function suggestSong(eventId, token, participantId, overrides = {}) {
  const res = await request(app)
    .post(`/api/v1/songs/${eventId}/suggest`)
    .set(authHeader(token))
    .send({
      participantId,
      title: 'Functional Track',
      artist: 'Functional Artist',
      totalDuration: 180,
      ...overrides,
    })
    .expect(201);

  return res.body.data.song;
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
    EventMemberModel.deleteMany({}),
    AudioTrackModel.deleteMany({}),
    EventModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    SongModel.deleteMany({}),
    UserModel.deleteMany({}),
    VoteModel.deleteMany({}),
  ]);
});

describe('REST functional coverage', () => {
  test('updates authenticated profile and profile picture through persisted user data', async () => {
    const attendee = await registerUser();
    const token = attendee.body.data.token;

    await request(app)
      .patch('/api/v1/auth/me')
      .set(authHeader(token))
      .send({ displayName: '  Ada Requests  ' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.user.displayName).toBe('Ada Requests');
      });

    await request(app)
      .patch('/api/v1/auth/me/picture')
      .set(authHeader(token))
      .send({ profilePicture: 'avatar-42' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.user.profilePicture).toBe('avatar-42');
      });

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(authHeader(token))
      .expect(200);

    expect(me.body.data.user).toMatchObject({
      displayName: 'Ada Requests',
      profilePicture: 'avatar-42',
    });
  });

  test('runs event lifecycle, active listing, access-code regeneration and owner authorization', async () => {
    const dj = await createVerifiedDj();
    const otherDj = await createVerifiedDj({
      email: 'other-functional-dj@example.com',
      displayName: 'Other DJ',
    });
    const event = await createEvent(dj.token);

    await request(app)
      .put(`/api/v1/events/${event.id}`)
      .set(authHeader(dj.token))
      .send({
        name: 'Renamed Functional Event',
        description: 'Updated description',
        settings: { allowRequests: false, maxRequestsPerParticipant: 1 },
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.event).toMatchObject({
          name: 'Renamed Functional Event',
          description: 'Updated description',
        });
        expect(res.body.data.event.settings.allowRequests).toBe(false);
      });

    await request(app)
      .put(`/api/v1/events/${event.id}`)
      .set(authHeader(otherDj.token))
      .send({ name: 'Stolen Event' })
      .expect(401);

    await request(app)
      .post(`/api/v1/events/${event.id}/start`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.event.state).toBe('LIVE');
      });

    await request(app)
      .get('/api/v1/events')
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.events.map((item) => item.id)).toContain(event.id);
      });

    const regenerated = await request(app)
      .post(`/api/v1/events/${event.id}/regenerate-code`)
      .set(authHeader(dj.token))
      .expect(200);

    expect(regenerated.body.data.event.accessCode).not.toBe(event.accessCode);

    await request(app)
      .get(`/api/v1/events/access/${event.accessCode}`)
      .expect(404);

    await request(app)
      .get(`/api/v1/events/access/${regenerated.body.data.event.accessCode.toLowerCase()}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.event.id).toBe(event.id);
      });

    await request(app)
      .post(`/api/v1/events/${event.id}/end`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.event.state).toBe('ENDED');
        expect(res.body.data.event.endedAt).toEqual(expect.any(String));
      });
  });

  test('cancels events with reason and removes them from active listings', async () => {
    const dj = await createVerifiedDj();
    const event = await createEvent(dj.token, { name: 'Cancellable Event' });

    await request(app)
      .post(`/api/v1/events/${event.id}/start`)
      .set(authHeader(dj.token))
      .expect(200);

    await request(app)
      .post(`/api/v1/events/${event.id}/cancel`)
      .set(authHeader(dj.token))
      .send({ reason: 'Weather' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.event.state).toBe('CANCELLED');
      });

    await expect(EventModel.findById(event.id).lean()).resolves.toMatchObject({
      state: 'CANCELLED',
      cancelledReason: 'Weather',
    });

    await request(app)
      .get('/api/v1/events')
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.events).toHaveLength(0);
      });
  });

  test('protects participant nicknames, resumes password-protected sessions and bans rejoin', async () => {
    const dj = await createVerifiedDj();
    const attendee = await registerUser({ displayName: 'Protected Guest' });
    const otherAttendee = await registerUser({ displayName: 'Other Guest' });
    const attendeeToken = attendee.body.data.token;
    const event = await createEvent(dj.token);

    const participant = await joinEvent(event.id, attendeeToken, 'Casey');

    await request(app)
      .post(`/api/v1/participants/${participant._id}/leave`)
      .set(authHeader(otherAttendee.body.data.token))
      .expect(403);

    await request(app)
      .get(`/api/v1/participants/${participant._id}`)
      .set(authHeader(attendeeToken))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.nickname).toBe('Casey');
      });

    await request(app)
      .post(`/api/v1/participants/${participant._id}/password`)
      .set(authHeader(attendeeToken))
      .send({ password: 'SeatPass123!' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.passwordProtected).toBe(true);
      });

    await request(app)
      .post(`/api/v1/participants/${participant._id}/leave`)
      .set(authHeader(attendeeToken))
      .expect(200);

    await request(app)
      .post(`/api/v1/participants/${event.id}/join`)
      .set(authHeader(attendeeToken))
      .send({ nickname: 'Casey', password: 'wrong-pass' })
      .expect(400);

    await request(app)
      .post(`/api/v1/participants/${event.id}/join`)
      .set(authHeader(attendeeToken))
      .send({ nickname: 'Casey', password: 'SeatPass123!' })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.participant._id).toBe(participant._id);
        expect(res.body.data.participant.leftAt).toBeFalsy();
      });

    await request(app)
      .post(`/api/v1/participants/${participant._id}/ban`)
      .set(authHeader(dj.token))
      .send({ reason: 'Abuse' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.isBanned).toBe(true);
      });

    await request(app)
      .post(`/api/v1/participants/${event.id}/join`)
      .set(authHeader(attendeeToken))
      .send({ nickname: 'Casey', password: 'SeatPass123!' })
      .expect(403);
  });

  test('suggested songs include close fingerprint metadata matches', async () => {
    const dj = await createVerifiedDj();
    const attendee = await registerUser({ displayName: 'Request Guest' });
    const event = await createEvent(dj.token);
    const participant = await joinEvent(event.id, attendee.body.data.token, 'Riley');

    const track = await AudioTrackModel.create({
      eventId: event.id,
      title: 'Midnight City',
      artist: 'M83',
      coverUrl: 'https://example.com/midnight.jpg',
      uploadedBy: dj.user.id,
      duration: 244,
      sampleRate: 44100,
      pointsCount: 1,
      hashesCount: 1,
    });

    const song = await suggestSong(event.id, attendee.body.data.token, participant._id, {
      title: 'Midnight Cty',
      artist: 'M83',
    });

    expect(song.recognitionMatch).toMatchObject({
      trackId: track._id.toString(),
      title: 'Midnight City',
      artist: 'M83',
      coverUrl: 'https://example.com/midnight.jpg',
      matchedOn: 'title_artist',
    });
    expect(song.recognitionMatch.score).toBeGreaterThan(0.8);

    await request(app)
      .post(`/api/v1/songs/${event.id}/${song.id}/approve`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.song).toMatchObject({
          title: 'Midnight City',
          artist: 'M83',
          status: 'APPROVED',
        });
      });
  });

  test('participant endpoints exclude event owner rows from lists and counts', async () => {
    const dj = await createVerifiedDj();
    const attendee = await registerUser({ displayName: 'Visible Guest' });
    const event = await createEvent(dj.token);
    const participant = await joinEvent(event.id, attendee.body.data.token, 'Visible');

    await ParticipantModel.create({
      eventId: event.id,
      nickname: 'Owner Row',
      userId: dj.user.id,
    });

    await request(app)
      .get(`/api/v1/events/${event.id}/participants`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.count).toBe(1);
        expect(res.body.data.participants.map((p) => p._id.toString())).toEqual([
          participant._id,
        ]);
      });

    await request(app)
      .get(`/api/v1/participants/${event.id}/list`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.count).toBe(1);
        expect(res.body.data.participants.map((p) => p._id)).toEqual([
          participant._id,
        ]);
      });
  });

  test('event DJ members can cooldown attendees and create phone microphone links', async () => {
    const owner = await createVerifiedDj();
    const eventDj = await createVerifiedDj({
      email: 'event-member-dj@example.com',
      displayName: 'Event DJ',
    });
    const attendee = await registerUser({ displayName: 'Cooldown Guest' });
    const event = await createEvent(owner.token);
    const participant = await joinEvent(event.id, attendee.body.data.token, 'Morgan');

    await EventMemberModel.create({
      eventId: event.id,
      userId: eventDj.user.id,
      role: 'DJ',
      permissions: [],
      addedBy: owner.user.id,
    });

    await request(app)
      .post(`/api/v1/participants/${participant._id}/cooldown`)
      .set(authHeader(eventDj.token))
      .send({ durationMs: 60_000, reason: 'Queue spam' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.cooldownUntil).toEqual(expect.any(String));
        expect(res.body.data.participant.cooldownReason).toBe('Queue spam');
      });

    await request(app)
      .get(`/api/v1/events/${event.id}/phone-microphone-link`)
      .set(authHeader(eventDj.token))
      .set('Origin', 'https://192.168.1.50:5173')
      .expect(200)
      .expect((res) => {
        expect(res.body.data.link).toMatch(
          new RegExp(`^https://192\\.168\\.1\\.50:5173/dj/microphone/${event.id}#token=`),
        );
      });
  });

  test('unscoped DJs cannot create phone microphone links for other events', async () => {
    const owner = await createVerifiedDj();
    const otherDj = await createVerifiedDj({
      email: 'unscoped-dj@example.com',
      displayName: 'Unscoped DJ',
    });
    const event = await createEvent(owner.token);

    await request(app)
      .get(`/api/v1/events/${event.id}/phone-microphone-link`)
      .set(authHeader(otherDj.token))
      .expect(403);
  });

  test('orders queue by playing state and votes, exposes positions, skip and empty vote state', async () => {
    const dj = await createVerifiedDj();
    const attendeeA = await registerUser({ displayName: 'Voter A' });
    const attendeeB = await registerUser({ displayName: 'Voter B' });
    const event = await createEvent(dj.token);
    const participantA = await joinEvent(event.id, attendeeA.body.data.token, 'Aria');
    const participantB = await joinEvent(event.id, attendeeB.body.data.token, 'Bea');

    const first = await suggestSong(event.id, attendeeA.body.data.token, participantA._id, {
      title: 'First Track',
    });
    const second = await suggestSong(event.id, attendeeB.body.data.token, participantB._id, {
      title: 'Second Track',
    });

    await request(app)
      .post(`/api/v1/songs/${event.id}/${first.id}/approve`)
      .set(authHeader(dj.token))
      .expect(200);
    await request(app)
      .post(`/api/v1/songs/${event.id}/${second.id}/approve`)
      .set(authHeader(dj.token))
      .expect(200);

    await request(app)
      .post('/api/v1/votes')
      .set(authHeader(attendeeA.body.data.token))
      .send({ songId: second.id, participantId: participantA._id, value: 1 })
      .expect(201);

    await request(app)
      .get(`/api/v1/votes/${first.id}/${participantA._id}`)
      .set(authHeader(attendeeA.body.data.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.vote).toBeNull();
      });

    await request(app)
      .get(`/api/v1/songs/${event.id}/queue`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.queue.map((song) => song.title)).toEqual([
          'Second Track',
          'First Track',
        ]);
        expect(res.body.data.queue.map((song) => song.queuePosition)).toEqual([1, 2]);
      });

    await request(app)
      .get(`/api/v1/songs/${second.id}/position`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.position).toBe(1);
      });

    // Simulate phone-mic audio fingerprinting match
    const track = await AudioTrackModel.create({
      eventId: event._id || event.id,
      title: second.title,
      artist: second.artist,
      uploadedBy: dj.user.id,
      duration: 200,
      sampleRate: 8000,
      pointsCount: 1,
      hashesCount: 1,
    });
    await SongModel.updateOne(
      { _id: second.id },
      {
        $set: {
          'recognitionMatch.trackId': track._id,
          'recognitionMatch.title': second.title,
          'recognitionMatch.artist': second.artist,
          'recognitionMatch.score': 1,
          'recognitionMatch.matchedOn': 'title',
        },
      },
    );

    await request(app)
      .post(`/api/v1/songs/${event.id}/${second.id}/send-now`)
      .set(authHeader(dj.token))
      .expect(200);

    await request(app)
      .post(`/api/v1/songs/${event.id}/${second.id}/skip`)
      .set(authHeader(dj.token))
      .send({ reason: 'Short set' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.song.status).toBe('SKIPPED');
        expect(res.body.data.song.skippedAt).toEqual(expect.any(String));
      });

    await request(app)
      .get(`/api/v1/songs/${event.id}/queue`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.queue.map((song) => song.id)).toEqual([first.id]);
        expect(res.body.data.queue[0].queuePosition).toBe(1);
      });
  });
  test('covers auth, public attendee session, participant profile, pending/reject, vote stats and logout paths', async () => {
    const dj = await createVerifiedDj();
    const event = await createEvent(dj.token);

    await request(app)
      .post('/api/v1/participants/nickname/validate')
      .send({ eventId: event.id, nickname: 'Web Guest' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.valid).toBe(true);
      });

    const sessionRes = await request(app)
      .post(`/api/v1/attendee-session/events/${event.id}/join`)
      .send({ nickname: 'Web Guest', profilePicture: 'web-avatar' })
      .expect(201);
    const attendeeToken = sessionRes.body.data.token;
    const participant = sessionRes.body.data.participant;

    await request(app)
      .patch(`/api/v1/participants/${participant._id}/profile`)
      .set(authHeader(attendeeToken))
      .send({ nickname: 'Web Guest Renamed', profilePicture: 'renamed-avatar' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant).toMatchObject({
          nickname: 'Web Guest Renamed',
          profilePicture: 'renamed-avatar',
        });
      });

    await request(app)
      .put(`/api/v1/participants/${participant._id}/premium`)
      .set(authHeader(dj.token))
      .send({ isPremium: true })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.isPremium).toBe(true);
      });

    const keepSong = await suggestSong(event.id, attendeeToken, participant._id, {
      title: 'Keep Me',
    });
    const rejectSong = await suggestSong(event.id, attendeeToken, participant._id, {
      title: 'Reject Me',
    });

    await request(app)
      .get(`/api/v1/songs/${event.id}/pending`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.pending.map((song) => song.id)).toEqual(
          expect.arrayContaining([keepSong.id, rejectSong.id]),
        );
      });

    await request(app)
      .post(`/api/v1/songs/${event.id}/${rejectSong.id}/reject`)
      .set(authHeader(dj.token))
      .send({ reason: 'Duplicate' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.song.status).toBe('REJECTED');
      });

    await request(app)
      .post(`/api/v1/songs/${event.id}/${keepSong.id}/approve`)
      .set(authHeader(dj.token))
      .expect(200);

    await request(app)
      .post('/api/v1/votes')
      .set(authHeader(attendeeToken))
      .send({ songId: keepSong.id, participantId: participant._id, value: 1 })
      .expect(201);

    await request(app)
      .get(`/api/v1/votes/${event.id}/stats`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.stats.total_votes).toBe(2);
      });

    await request(app)
      .delete(`/api/v1/votes/${keepSong.id}/${participant._id}`)
      .set(authHeader(attendeeToken))
      .expect(200);

    await request(app)
      .post(`/api/v1/participants/${participant._id}/kick`)
      .set(authHeader(dj.token))
      .send({ reason: 'Done testing' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.participant.leftAt).toEqual(expect.any(String));
      });

    await request(app)
      .post('/api/v1/auth/logout')
      .set(authHeader(attendeeToken))
      .expect(200);
  });

});
