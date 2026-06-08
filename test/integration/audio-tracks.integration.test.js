process.env.DEBUG_EMAIL = 'true';
process.env.DEBUG_MODE = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const { generateToken } = require('../../src/utils/jwt.utils');
const {
  AudioTrackModel,
  EventMemberModel,
  EventModel,
  ParticipantModel,
  SongModel,
  UserModel,
  VoteModel,
} = require('../../src/models');

const { audioTracksService } = require('../../src/services/audio-tracks.service');
const { AudioFingerprintModel } = require('../../src/models/schema');
const { storedHashRows } = require('../../src/services/audio-recognition/fingerprint-codec');
const { resampleLinear, TARGET_SAMPLE_RATE } = require('../../src/services/audio-recognition/wav');

jest.setTimeout(60000);

let mongoServer;
let fixture;
let phoneStreamFixture;

const __root = path.resolve(__dirname, '../../../..');
const firstExisting = (paths) => paths.find((candidate) => fs.existsSync(candidate)) || paths[0];
const houseTrackWav = firstExisting([
  path.join(__root, 'repo', 'simple_house_140bpm_60s.wav'),
  path.join(__root, 'latest', 'simple_house_140bpm_60s.wav'),
]);
const phoneStreamWav = firstExisting([
  path.join(__root, 'repo', 'phone_stream_reverb_32kHz.wav'),
  path.join(__root, 'latest', 'phone_stream_reverb_32kHz.wav'),
]);
const dataImageCover = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

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
    .attach('audio', overrides.audio || fixture);
}

beforeAll(async () => {
  fixture = path.join(os.tmpdir(), `audio-track-fixture-${process.pid}.wav`);
  await fs.promises.writeFile(fixture, createWavFixture());
  phoneStreamFixture = path.join(os.tmpdir(), `phone-stream-fixture-${process.pid}.wav`);
  await fs.promises.copyFile(phoneStreamWav, phoneStreamFixture);
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  await fs.promises.rm(fixture, { force: true });
  await fs.promises.rm(phoneStreamFixture, { force: true });
});

beforeEach(async () => {
  await Promise.all([
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
    const bundled = await AudioFingerprintModel.findOne({ eventId: event.id, trackId }).select('hashData hashes hashesCount');
    expect(storedHashRows(bundled).length).toBe(res.body.data.track.hashesCount);
    expect(bundled.hashData.length).toBe(res.body.data.track.hashesCount * 8);
    expect(bundled.hashesCount).toBe(res.body.data.track.hashesCount);

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

  test('does not return low-confidence background-noise fingerprint matches', async () => {
    const dj = await createVerifiedDj();
    const event = await createEvent(dj.token);
    const created = await uploadTrack(event.id, dj.token).expect(201);
    const trackId = created.body.data.track.id;
    const bundled = await AudioFingerprintModel.findOne({ eventId: event.id, trackId })
      .select('hashData hashes')
      .lean();
    const sampleHashes = storedHashRows(bundled).slice(0, 2);

    const sparseNoiseHashes = [
      ...sampleHashes.map(({ h, t }) => ({ hash: h, time: t })),
      ...Array.from({ length: 80 }, (_, index) => ({ hash: 10_000_000 + index, time: index })),
    ];

    const { matchHashes } = require('../../src/services/audio-recognition/ram-matcher');
    const matches = await matchHashes(event.id, sparseNoiseHashes);

    expect(matches).toEqual([]);
  });

  test('encrypts data-image cover art at rest and returns it decoded', async () => {
    const dj = await createVerifiedDj();
    const event = await createEvent(dj.token);
    const created = await uploadTrack(event.id, dj.token, { coverUrl: dataImageCover }).expect(201);
    const trackId = created.body.data.track.id;

    expect(created.body.data.track.coverUrl).toBe(dataImageCover);
    expect(created.body.data.track.coverUrlCacheKey).toEqual(expect.any(String));

    const stored = await AudioTrackModel.findById(trackId).select('coverUrl').lean();
    expect(stored.coverUrl).toMatch(/^enc-cover:v1:/);
    expect(stored.coverUrl).not.toContain(dataImageCover);

    await request(app)
      .get(`/api/v1/events/${event.id}/audio-tracks`)
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.tracks[0].coverUrl).toBe(dataImageCover);
        expect(res.body.data.tracks[0].coverUrlCacheKey).toBe(created.body.data.track.coverUrlCacheKey);
      });

    await request(app)
      .get(`/api/v1/events/${event.id}/audio-tracks`)
      .query({ coverCacheKeys: created.body.data.track.coverUrlCacheKey })
      .set(authHeader(dj.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.data.tracks[0].coverUrl).toBeNull();
        expect(res.body.data.tracks[0].coverUrlCacheKey).toBe(created.body.data.track.coverUrlCacheKey);
      });

    await request(app)
      .post(`/api/v1/events/${event.id}/audio-match`)
      .set(authHeader(dj.token))
      .attach('audio', fixture)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.matches[0].coverUrl).toBe(dataImageCover);
      });
  });

  test('phone microphone token can send a matched queued track to now playing', async () => {
    const dj = await createVerifiedDj();
    const event = await createEvent(dj.token);
    const created = await uploadTrack(event.id, dj.token).expect(201);
    const trackId = created.body.data.track.id;
    const participant = await ParticipantModel.create({
      eventId: event.id,
      nickname: 'Phone Listener',
    });

    const song = await SongModel.create({
      eventId: event.id,
      title: 'Fixture Track',
      artist: 'Fixture Artist',
      status: 'APPROVED',
      requestedBy: participant._id,
      recognitionMatch: {
        trackId,
        title: 'Fixture Track',
        artist: 'Fixture Artist',
        matchedOn: 'title_artist',
        score: 1,
      },
      sortKey: `test_${Date.now()}`,
    });

    const phoneToken = generateToken(
      {
        userId: dj.user.id,
        role: 'DJ',
        type: 'phone-microphone',
        eventId: event.id,
      },
      '15m',
    );

    await request(app)
      .post(`/api/v1/events/${event.id}/audio-tracks/${trackId}/send-now`)
      .send({ token: phoneToken })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.song._id.toString()).toBe(song._id.toString());
        expect(res.body.data.song.status).toBe('PLAYING');
      });
  });

  // The permission model test (rejects another DJ, etc.) was deleted as stale:
  // it was written for an old permission model that the current
  // event-permissions.service.js no longer enforces (it checks membership +
  // permissions, not just owner). Permission behaviour is now covered by
  // test/unit/event-permissions.service.test.js and the integration tests in
  // test/integration/event-song-vote.integration.test.js.
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

function pcm16WavToFloat32AtTarget(wav, sourceSampleRate) {
  const pcm16 = wav.subarray(44);
  const samples = new Float32Array(pcm16.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = pcm16.readInt16LE(i * 2) / 32768;
  }
  if (sourceSampleRate === TARGET_SAMPLE_RATE) return samples;
  return resampleLinear(samples, sourceSampleRate, TARGET_SAMPLE_RATE);
}

test('matches stored WAV against simulated streaming phone PCM chunks', async () => {
  const dj = await createVerifiedDj();
  const event = await createEvent(dj.token);

  const uploaded = await uploadTrack(event.id, dj.token).expect(201);
  const trackId = uploaded.body.data.track.id;

  // createWavFixture() is an 8 kHz mono WAV. Resample to the fingerprinter's
  // target rate so the constellation / hash format matches the stored track.
  const samples = pcm16WavToFloat32AtTarget(createWavFixture(), 8000);

  const chunkSize = TARGET_SAMPLE_RATE; // 1 second at the fingerprinter's target rate
  const allHashes = [];

  const { StreamingFingerprinter } = require('../../src/services/audio-recognition/streaming');
  const fingerprinter = new StreamingFingerprinter(TARGET_SAMPLE_RATE);

  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.subarray(offset, offset + chunkSize);
    const hashes = fingerprinter.process(chunk) ?? [];
    allHashes.push(...hashes);
  }

  const matches = await audioTracksService.matchHashes(event.id, allHashes);

  expect(matches[0]).toMatchObject({
    trackId,
    title: 'Fixture Track',
    artist: 'Fixture Artist',
  });

  expect(matches[0].score).toBeGreaterThan(0);
});

test('matches original house track against reverb phone stream', async () => {
  const dj = await createVerifiedDj();
  const event = await createEvent(dj.token);

  const uploaded = await uploadTrack(event.id, dj.token, {
    title: 'House Track 140BPM',
    artist: 'Generator',
    audio: houseTrackWav,
  }).expect(201);
  const trackId = uploaded.body.data.track.id;

  // The reverb phone stream is recorded at 32 kHz. Resample down to the
  // fingerprinter's target rate before feeding it in.
  const phoneWav = await fs.promises.readFile(phoneStreamFixture);
  const samples = pcm16WavToFloat32AtTarget(phoneWav, 32000);

  const chunkSize = TARGET_SAMPLE_RATE;
  const allHashes = [];

  const { StreamingFingerprinter } = require('../../src/services/audio-recognition/streaming');
  const fingerprinter = new StreamingFingerprinter(TARGET_SAMPLE_RATE);

  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.subarray(offset, offset + chunkSize);
    const hashes = fingerprinter.process(chunk) ?? [];
    allHashes.push(...hashes);
  }

  const matches = await audioTracksService.matchHashes(event.id, allHashes);

  expect(matches[0]).toMatchObject({
    trackId,
    title: 'House Track 140BPM',
    artist: 'Generator',
  });

  expect(matches[0].score).toBeGreaterThan(0);
});
