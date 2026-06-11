/**
 * Matcher confidence and edge-case tests.
 *
 * Targets the RAM matcher (the only matcher). Documents the
 * false-positive / false-negative behaviour the system relies on:
 *
 *   1. `MIN_MATCH_SCORE`   – an absolute score threshold (rejects noise)
 *   2. `normalizeHashRows` – dedup + sanitisation of the query hashes
 *
 * The tests do not mock the matcher; they use the real implementation
 * against a real `mongodb-memory-server` instance and against the in-memory
 * RAM matcher.
 */

process.env.DEBUG_MODE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { normalizeHashRows: ramNormalize, matchHashes } = require('../../src/services/audio-recognition/ram-matcher');
const { AudioFingerprintModel, AudioTrackModel } = require('../../src/models/schema');
const { createHashes } = require('../../src/services/audio-recognition/hashes');
const { createConstellation } = require('../../src/services/audio-recognition/constellation');
const { readWavNormalized, TARGET_SAMPLE_RATE } = require('../../src/services/audio-recognition/wav');

jest.setTimeout(60000);

const MIN_MATCH_SCORE = 4;

let mongoServer;

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
    AudioFingerprintModel.deleteMany({}),
    AudioTrackModel.deleteMany({}),
  ]);
});

describe('RAM matcher with bundled AudioFingerprintModel', () => {
  test('rejects matches below MIN_MATCH_SCORE', async () => {
    const eventId = new mongoose.Types.ObjectId();
    const trackId = new mongoose.Types.ObjectId();
    const uploaderId = new mongoose.Types.ObjectId();
    await AudioTrackModel.create({
      _id: trackId,
      eventId,
      title: 'A',
      artist: 'A',
      audioSha256: 'a'.repeat(64),
      uploadedBy: uploaderId,
      duration: 1,
      sampleRate: TARGET_SAMPLE_RATE,
      pointsCount: 0,
      hashesCount: 0,
    });
    const hashes = Array.from({ length: MIN_MATCH_SCORE - 1 }, (_, i) => ({ h: 1000 + i, t: i }));
    await AudioFingerprintModel.create({
      eventId,
      trackId,
      sampleRate: TARGET_SAMPLE_RATE,
      duration: 1,
      pointsCount: 0,
      hashesCount: hashes.length,
      hashes,
    });
    const matches = await matchHashes(eventId.toString(), hashes.map(({ h, t }) => ({ hash: h, time: t })));
    expect(matches).toEqual([]);
  });

  test('accepts a single clear winner with aligned hashes', async () => {
    const eventId = new mongoose.Types.ObjectId();
    const trackId = new mongoose.Types.ObjectId();
    const uploaderId = new mongoose.Types.ObjectId();
    await AudioTrackModel.create({
      _id: trackId,
      eventId,
      title: 'A',
      artist: 'A',
      audioSha256: 'a'.repeat(64),
      uploadedBy: uploaderId,
      duration: 1,
      sampleRate: TARGET_SAMPLE_RATE,
      pointsCount: 0,
      hashesCount: 0,
    });

    const aligned = 10;
    const hashes = [];
    for (let i = 0; i < aligned; i += 1) hashes.push({ h: 2000 + i, t: i });
    await AudioFingerprintModel.create({
      eventId,
      trackId,
      sampleRate: TARGET_SAMPLE_RATE,
      duration: 1,
      pointsCount: 0,
      hashesCount: aligned,
      hashes,
    });

    const matches = await matchHashes(eventId.toString(), hashes.map(({ h, t }) => ({ hash: h, time: t })));
    expect(matches).toHaveLength(1);
    expect(matches[0].trackId).toBe(trackId.toString());
    expect(matches[0].score).toBe(aligned);
  });

  test('returns both tied tracks (no gap guard)', async () => {
    const eventId = new mongoose.Types.ObjectId();
    const trackA = new mongoose.Types.ObjectId();
    const trackB = new mongoose.Types.ObjectId();
    const uploaderId = new mongoose.Types.ObjectId();
    await AudioTrackModel.create([
      { _id: trackA, eventId, title: 'A', artist: 'A', audioSha256: 'a'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: TARGET_SAMPLE_RATE, pointsCount: 0, hashesCount: 0 },
      { _id: trackB, eventId, title: 'B', artist: 'B', audioSha256: 'b'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: TARGET_SAMPLE_RATE, pointsCount: 0, hashesCount: 0 },
    ]);

    const topScore = 6;
    const secondScore = 5;
    const trackAHashes = [];
    const trackBHashes = [];
    for (let i = 0; i < topScore; i += 1) trackAHashes.push({ h: 3000 + i, t: i });
    for (let i = 0; i < secondScore; i += 1) trackBHashes.push({ h: 4000 + i, t: i });
    await AudioFingerprintModel.insertMany([
      { eventId, trackId: trackA, sampleRate: TARGET_SAMPLE_RATE, duration: 1, pointsCount: 0, hashesCount: trackAHashes.length, hashes: trackAHashes },
      { eventId, trackId: trackB, sampleRate: TARGET_SAMPLE_RATE, duration: 1, pointsCount: 0, hashesCount: trackBHashes.length, hashes: trackBHashes },
    ]);

    const query = [...trackAHashes, ...trackBHashes].map(({ h, t }) => ({ hash: h, time: t }));
    const matches = await matchHashes(eventId.toString(), query);
    expect(matches).toHaveLength(2);
    expect(matches[0].trackId).toBe(trackA.toString());
    expect(matches[0].score).toBe(topScore);
    expect(matches[1].trackId).toBe(trackB.toString());
    expect(matches[1].score).toBe(secondScore);
  });
});

describe('normalizeHashRows', () => {
  test('deduplicates by (hash, time) pair so the same hash at different times is kept', () => {
    const rows = ramNormalize([
      { hash: 1, time: 0 },
      { hash: 1, time: 5 },
      { hash: 2, time: 1 },
    ]);
    expect(rows).toEqual([
      { hash: 1, time: 0 },
      { hash: 1, time: 5 },
      { hash: 2, time: 1 },
    ]);
  });

  test('drops exact duplicates of the same (hash, time) pair', () => {
    const rows = ramNormalize([
      { hash: 1, time: 0 },
      { hash: 1, time: 0 },
      { hash: 2, time: 1 },
    ]);
    expect(rows).toEqual([{ hash: 1, time: 0 }, { hash: 2, time: 1 }]);
  });

  test('skips non-finite values', () => {
    const rows = ramNormalize([
      { hash: NaN, time: 0 },
      { hash: 1, time: NaN },
      { hash: 1, time: 0 },
      { hash: 2, time: 0 },
    ]);
    expect(rows).toEqual([{ hash: 1, time: 0 }, { hash: 2, time: 0 }]);
  });
});

describe('RAM matcher end-to-end with real fingerprints', () => {
  const path = require('path');
  const fixture = path.join(__dirname, '..', 'fixtures', 'simple_house_140bpm_60s.wav');

  test('matches an uploaded track against a noisy query that still has aligned hashes', async () => {
    const { samples, sampleRate } = await readWavNormalized(fixture, TARGET_SAMPLE_RATE);
    const constellation = createConstellation(samples, sampleRate);
    const hashes = [...createHashes(constellation)].map(([hash, [time]]) => ({ hash, time }));

    const eventId = new mongoose.Types.ObjectId();
    const trackId = new mongoose.Types.ObjectId();
    const uploaderId = new mongoose.Types.ObjectId();
    await AudioTrackModel.create({
      _id: trackId,
      eventId,
      title: 'House',
      artist: 'Generator',
      audioSha256: 'c'.repeat(64),
      uploadedBy: uploaderId,
      duration: 60,
      sampleRate: TARGET_SAMPLE_RATE,
      pointsCount: 0,
      hashesCount: 0,
    });

    const sample = hashes.slice(0, 200);
    await AudioFingerprintModel.create({
      eventId,
      trackId,
      sampleRate: TARGET_SAMPLE_RATE,
      duration: 60,
      pointsCount: 0,
      hashesCount: sample.length,
      hashes: sample.map(({ hash, time }) => ({ h: hash, t: time })),
    });

    const noisyQuery = [
      ...sample,
      ...Array.from({ length: 80 }, (_, i) => ({ hash: 9_000_000 + i, time: i })),
    ];

    const matches = await matchHashes(eventId.toString(), noisyQuery);
    expect(matches[0]).toMatchObject({ trackId: trackId.toString(), title: 'House' });
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  test('returns both tied tracks sorted by score (no gap guard)', async () => {
    const eventId = new mongoose.Types.ObjectId();
    const trackA = new mongoose.Types.ObjectId();
    const trackB = new mongoose.Types.ObjectId();
    const uploaderId = new mongoose.Types.ObjectId();
    await AudioTrackModel.create([
      { _id: trackA, eventId, title: 'A', artist: 'A', audioSha256: 'd'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: TARGET_SAMPLE_RATE, pointsCount: 0, hashesCount: 0 },
      { _id: trackB, eventId, title: 'B', artist: 'B', audioSha256: 'e'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: TARGET_SAMPLE_RATE, pointsCount: 0, hashesCount: 0 },
    ]);

    const tiedScore = 8;
    const trackAHashes = [];
    const trackBHashes = [];
    for (let i = 0; i < tiedScore; i += 1) {
      trackAHashes.push({ h: 6000 + i, t: i });
      trackBHashes.push({ h: 7000 + i, t: i });
    }
    await AudioFingerprintModel.insertMany([
      { eventId, trackId: trackA, sampleRate: TARGET_SAMPLE_RATE, duration: 1, pointsCount: 0, hashesCount: tiedScore, hashes: trackAHashes },
      { eventId, trackId: trackB, sampleRate: TARGET_SAMPLE_RATE, duration: 1, pointsCount: 0, hashesCount: tiedScore, hashes: trackBHashes },
    ]);

    const query = [...trackAHashes, ...trackBHashes].map(({ h, t }) => ({ hash: h, time: t }));
    const matches = await matchHashes(eventId.toString(), query);
    expect(matches).toHaveLength(2);
    expect(matches[0].score).toBe(tiedScore);
    expect(matches[1].score).toBe(tiedScore);
  });
});
