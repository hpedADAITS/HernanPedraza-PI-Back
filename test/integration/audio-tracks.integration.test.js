process.env.DEBUG_EMAIL = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const {
  AudioFingerprintHashModel,
  AudioFingerprintPointModel,
  AudioTrackModel,
  EventMemberModel,
  EventModel,
  ParticipantModel,
  SongModel,
  UserModel,
  VoteModel,
} = require('../../src/models');

jest.setTimeout(60000);

let mongoServer;
let fixture;

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });
const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function createVerifiedDj(overrides = {}) {
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `audio-dj-${seed}@example.com`,
      password: 'StrongPass123!',
      displayName: 'Audio DJ',
      role: 'DJ',
      ...overrides,
    })
    .expect(201);

  await request(app)
    .get(`/api/v1/auth/verify-email/${res.body.data.emailVerificationToken}`)
    .expect(200);

  return {
    token: res.body.data.token,
    user: res.body.data.user,
  };
}

async function createEvent(token) {
  const res = await request(app)
    .post('/api/v1/events')
    .set(authHeader(token))
    .send({
      name: 'Audio Fingerprint Event',
      description: 'Real audio upload coverage',
      startsAt: futureDate(),
    })
    .expect(201);

  return res.body.data.event;
}

function uploadTrack(eventId, token, overrides = {}) {
  return request(app)
    .post(`/api/v1/events/${eventId}/audio-tracks`)
    .set(authHeader(token))
    .field('title', overrides.title || 'Fixture Track')
    .field('artist', overrides.artist || 'Fixture Artist')
    .field('coverUrl', overrides.coverUrl || 'https://example.com/cover.jpg')
    .attach('audio', fixture);
}

beforeAll(async () => {
  fixture = path.join(os.tmpdir(), `audio-track-fixture-${process.pid}.wav`);
  await fs.promises.writeFile(fixture, createWavFixture());
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  await fs.promises.rm(fixture, { force: true });
});

beforeEach(async () => {
  await Promise.all([
    AudioFingerprintHashModel.deleteMany({}),
    AudioFingerprintPointModel.deleteMany({}),
    AudioTrackModel.deleteMany({}),
    EventMemberModel.deleteMany({}),
    EventModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    SongModel.deleteMany({}),
    UserModel.deleteMany({}),
    VoteModel.deleteMany({}),
  ]);
});

describe('Audio track REST integration', () => {
  test('fingerprints a real WAV through authenticated DJ POST and stores Mongo rows', async () => {
    const dj = await createVerifiedDj();
    const event = await createEvent(dj.token);

    const res = await uploadTrack(event.id, dj.token).expect(201);

    expect(res.body.data.track).toMatchObject({
      title: 'Fixture Track',
      artist: 'Fixture Artist',
      coverUrl: 'https://example.com/cover.jpg',
      sampleRate: expect.any(Number),
      pointsCount: expect.any(Number),
      hashesCount: expect.any(Number),
    });
    expect(res.body.data.track.pointsCount).toBeGreaterThan(0);
    expect(res.body.data.track.hashesCount).toBeGreaterThan(0);

    const trackId = res.body.data.track.id;
    await expect(AudioTrackModel.countDocuments({ eventId: event.id })).resolves.toBe(1);
    await expect(AudioFingerprintPointModel.countDocuments({ eventId: event.id, trackId })).resolves.toBe(
      res.body.data.track.pointsCount,
    );
    await expect(AudioFingerprintHashModel.countDocuments({ eventId: event.id, trackId })).resolves.toBe(
      res.body.data.track.hashesCount,
    );

    await request(app)
      .post(`/api/v1/events/${event.id}/audio-match`)
      .set(authHeader(dj.token))
      .attach('audio', fixture)
      .expect(200)
      .expect((matchRes) => {
        expect(matchRes.body.data.matches[0]).toMatchObject({
          trackId,
          title: 'Fixture Track',
          artist: 'Fixture Artist',
          coverUrl: 'https://example.com/cover.jpg',
          offset: 0,
          score: expect.any(Number),
        });
        expect(matchRes.body.data.matches[0].score).toBeGreaterThan(0);
      });
  });

  test('rejects another authenticated DJ and deletes owner fingerprints through REST', async () => {
    const owner = await createVerifiedDj();
    const other = await createVerifiedDj();
    const event = await createEvent(owner.token);

    await uploadTrack(event.id, other.token).expect(403);

    const created = await uploadTrack(event.id, owner.token).expect(201);
    const trackId = created.body.data.track.id;

    await request(app)
      .delete(`/api/v1/events/${event.id}/audio-tracks/${trackId}`)
      .set(authHeader(owner.token))
      .expect(200);

    await expect(AudioTrackModel.countDocuments({ _id: trackId })).resolves.toBe(0);
    await expect(AudioFingerprintPointModel.countDocuments({ trackId })).resolves.toBe(0);
    await expect(AudioFingerprintHashModel.countDocuments({ trackId })).resolves.toBe(0);
  });
});

function createWavFixture() {
  const sampleRate = 8000;
  const samples = sampleRate * 5;
  const data = Buffer.alloc(samples * 2);

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const sample = (
      Math.sin(2 * Math.PI * 440 * t) * 0.45
      + Math.sin(2 * Math.PI * 960 * t) * 0.35
      + Math.sin(2 * Math.PI * 1720 * t) * 0.2
    ) * 0x7fff;
    data.writeInt16LE(Math.max(-0x8000, Math.min(0x7fff, Math.round(sample))), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
