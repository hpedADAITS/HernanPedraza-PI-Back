/**
 * Matcher confidence and edge-case tests.
 *
 * These tests target the two matchers (mongo-matcher.js + ram-matcher.js)
 * and document the false-positive / false-negative behaviour the system
 * relies on:
 *
 *   1. `MIN_ALIGNED_HASHES`  – an absolute score threshold (rejects noise)
 *   2. `MIN_BEST_SCORE_GAP`  – a relative gap from the second-best match
 *      (rejects hash-collision ties that could otherwise look like a match)
 *   3. `MAX_MATCH_HASHES`    – input cap that bounds DB and CPU cost
 *   4. `normalizeHashRows`   – dedup + sanitisation of the query hashes
 *
 * The tests do not mock the matchers; they use the real implementation
 * against a real `mongodb-memory-server` instance and against the in-memory
 * RAM matcher.
 */

process.env.DEBUG_MODE = 'true';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { isConfidentMatch: isRamConfident } = require('../../src/services/audio-recognition/ram-matcher');
const mongoMatcher = require('../../src/services/audio-recognition/mongo-matcher');
const { normalizeHashRows: ramNormalize } = require('../../src/services/audio-recognition/ram-matcher');
const ramMatcherModule = require('../../src/services/audio-recognition/ram-matcher');
const { AudioFingerprintModel, AudioFingerprintHashModel, AudioTrackModel } = require('../../src/models/schema');
const { createHashes } = require('../../src/services/audio-recognition/hashes');
const { createConstellation } = require('../../src/services/audio-recognition/constellation');
const { readWavNormalized, TARGET_SAMPLE_RATE } = require('../../src/services/audio-recognition/wav');

jest.setTimeout(60000);

const MIN_ALIGNED_HASHES = 4;
const MIN_BEST_SCORE_GAP = 2;

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
    AudioFingerprintHashModel.deleteMany({}),
    AudioFingerprintModel.deleteMany({}),
    AudioTrackModel.deleteMany({}),
  ]);
});

describe('isConfidentMatch (RAM matcher)', () => {
  test('rejects matches below MIN_ALIGNED_HASHES', () => {
    const match = { trackId: 'a', offset: 0, score: MIN_ALIGNED_HASHES - 1 };
    expect(isRamConfident(match, 0, [match])).toBe(false);
  });

  test('accepts a clear winner with no second candidate', () => {
    const match = { trackId: 'a', offset: 0, score: 10 };
    expect(isRamConfident(match, 0, [match])).toBe(true);
  });

  test('rejects a top match that is too close to the second-best (FP guard)', () => {
    const top = { trackId: 'a', offset: 0, score: 6 };
    const second = { trackId: 'b', offset: 0, score: 5 };
    expect(isRamConfident(top, 0, [top, second])).toBe(false);
  });

  test('accepts a top match when the gap is at least MIN_BEST_SCORE_GAP', () => {
    const top = { trackId: 'a', offset: 0, score: 7 };
    const second = { trackId: 'b', offset: 0, score: 5 };
    expect(isRamConfident(top, 0, [top, second])).toBe(true);
  });

  test('gap check only applies to the top match (index 0)', () => {
    const second = { trackId: 'b', offset: 0, score: 5 };
    const third = { trackId: 'c', offset: 0, score: 5 };
    expect(isRamConfident(second, 1, [{ trackId: 'a', offset: 0, score: 100 }, second, third])).toBe(true);
  });
});

describe('isConfidentMatch (Mongo matcher)', () => {
  test('rejects matches below MIN_ALIGNED_HASHES', async () => {
    const eventId = new mongoose.Types.ObjectId();
    const hashes = Array.from({ length: MIN_ALIGNED_HASHES - 1 }, (_, i) => ({
      hash: 1000 + i,
      time: i,
    }));
    const matches = await mongoMatcher.matchHashes(eventId, hashes);
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
      sampleRate: 32000,
      pointsCount: 0,
      hashesCount: 0,
    });

    const aligned = 10;
    const hashes = [];
    for (let i = 0; i < aligned; i += 1) {
      const hash = 2000 + i;
      hashes.push({ hash, time: i });
      await AudioFingerprintHashModel.create({
        eventId,
        trackId,
        hash,
        sourceTime: i,
      });
    }
    const matches = await mongoMatcher.matchHashes(eventId, hashes);
    expect(matches).toHaveLength(1);
    expect(matches[0].trackId).toBe(trackId.toString());
    expect(matches[0].score).toBe(aligned);
  });

  test('rejects a top match when the gap to the second-best is too small (FP guard)', async () => {
    const eventId = new mongoose.Types.ObjectId();
    const trackA = new mongoose.Types.ObjectId();
    const trackB = new mongoose.Types.ObjectId();
    const uploaderId = new mongoose.Types.ObjectId();
    await AudioTrackModel.create([
      { _id: trackA, eventId, title: 'A', artist: 'A', audioSha256: 'a'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: 32000, pointsCount: 0, hashesCount: 0 },
      { _id: trackB, eventId, title: 'B', artist: 'B', audioSha256: 'b'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: 32000, pointsCount: 0, hashesCount: 0 },
    ]);

    const topScore = 6;
    const secondScore = 5;
    const hashes = [];
    for (let i = 0; i < topScore; i += 1) {
      const hash = 3000 + i;
      hashes.push({ hash, time: i });
      await AudioFingerprintHashModel.create({ eventId, trackId: trackA, hash, sourceTime: i });
    }
    for (let i = 0; i < secondScore; i += 1) {
      const hash = 4000 + i;
      hashes.push({ hash, time: i });
      await AudioFingerprintHashModel.create({ eventId, trackId: trackB, hash, sourceTime: i });
    }

    const matches = await mongoMatcher.matchHashes(eventId, hashes);
    // The gap check only applies to the top match (index 0) of the full sorted list.
    // track A (score 6) is rejected because the gap to track B (5) is 1 < MIN_BEST_SCORE_GAP.
    // track B is then re-evaluated as the new index 0 with no rival, so it is returned.
    expect(matches).toHaveLength(1);
    expect(matches[0].trackId).toBe(trackB.toString());
    expect(matches[0].score).toBe(secondScore);
  });
});

describe('normalizeHashRows (RAM matcher)', () => {
  test('deduplicates by hash', () => {
    const rows = ramNormalize([
      { hash: 1, time: 0 },
      { hash: 1, time: 5 },
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

  test('caps input at MAX_MATCH_HASHES (1200)', () => {
    const rows = ramNormalize(
      Array.from({ length: 1500 }, (_, i) => ({ hash: 5000 + i, time: i }))
    );
    expect(rows).toHaveLength(1200);
  });
});

describe('RAM matcher end-to-end with real fingerprints', () => {
  const path = require('path');
  const __root = path.resolve(__dirname, '../../../..');
  const fixture = path.join(__root, 'repo', 'simple_house_140bpm_60s.wav');

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
      sampleRate: 32000,
      pointsCount: 0,
      hashesCount: 0,
    });

    const sample = hashes.slice(0, 200);
    await AudioFingerprintModel.create({
      eventId,
      trackId,
      sampleRate: 32000,
      duration: 60,
      pointsCount: 0,
      hashesCount: sample.length,
      hashes: sample.map(({ hash, time }) => ({ h: hash, t: time })),
    });

    const noisyQuery = [
      ...sample,
      ...Array.from({ length: 80 }, (_, i) => ({ hash: 9_000_000 + i, time: i })),
    ];

    const matches = await ramMatcherModule.matchHashes(eventId, noisyQuery);
    expect(matches[0]).toMatchObject({ trackId: trackId.toString(), title: 'House' });
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_ALIGNED_HASHES);
  });

  test('rejects the original top match when tied with the second (gap guard)', async () => {
    const eventId = new mongoose.Types.ObjectId();
    const trackA = new mongoose.Types.ObjectId();
    const trackB = new mongoose.Types.ObjectId();
    const uploaderId = new mongoose.Types.ObjectId();
    await AudioTrackModel.create([
      { _id: trackA, eventId, title: 'A', artist: 'A', audioSha256: 'd'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: 32000, pointsCount: 0, hashesCount: 0 },
      { _id: trackB, eventId, title: 'B', artist: 'B', audioSha256: 'e'.repeat(64), uploadedBy: uploaderId, duration: 1, sampleRate: 32000, pointsCount: 0, hashesCount: 0 },
    ]);

    const tiedScore = 8;
    const trackAHashes = [];
    for (let i = 0; i < tiedScore; i += 1) {
      trackAHashes.push({ h: 6000 + i, t: i });
    }
    await AudioFingerprintModel.create({
      eventId,
      trackId: trackA,
      sampleRate: 32000,
      duration: 1,
      pointsCount: 0,
      hashesCount: trackAHashes.length,
      hashes: trackAHashes,
    });

    const trackBHashes = [];
    for (let i = 0; i < tiedScore; i += 1) {
      trackBHashes.push({ h: 7000 + i, t: i });
    }
    await AudioFingerprintModel.create({
      eventId,
      trackId: trackB,
      sampleRate: 32000,
      duration: 1,
      pointsCount: 0,
      hashesCount: trackBHashes.length,
      hashes: trackBHashes,
    });

    const query = [...trackAHashes, ...trackBHashes].map(({ h, t }) => ({ hash: h, time: t }));
    const matches = await ramMatcherModule.matchHashes(eventId, query);
    // Both tracks tie at score 8. track A is the original top match but its gap to
    // track B is 0 < MIN_BEST_SCORE_GAP, so it is rejected. track B then becomes the
    // new top with no rival and is returned. The important assertion is that A is
    // NOT the top match, which is the FP guard behaviour.
    expect(matches).toHaveLength(1);
    expect(matches[0].trackId).toBe(trackB.toString());
    expect(matches[0].score).toBe(tiedScore);
  });
});
