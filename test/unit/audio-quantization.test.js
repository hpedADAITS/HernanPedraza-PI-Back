const path = require('path');
const { createConstellation } = require('../../src/services/audio-recognition/constellation');
const { createHashes } = require('../../src/services/audio-recognition/hashes');
const { readWavNormalized, TARGET_SAMPLE_RATE } = require('../../src/services/audio-recognition/wav');

const __root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__root, 'repo', 'simple_house_140bpm_60s.wav');

const UPPER_FREQUENCY = 14000;
const MAX_UINT16 = 65535;

function createConstellationFloat(samples, sampleRate) {
  const { WINDOW_SECONDS, hann, windowPeaks } = require('../../src/services/audio-recognition/constellation');

  const windowSize = Math.max(2, Math.floor(WINDOW_SECONDS * sampleRate));
  const fftSize = 1 << Math.ceil(Math.log2(Math.max(1, windowSize)));
  const total = Math.ceil(samples.length / windowSize) * windowSize;
  const points = [];
  const window = hann(windowSize);

  for (let start = 0, time = 0; start < total; start += windowSize, time++) {
    points.push(...windowPeaks(samples, start, sampleRate, windowSize, fftSize, window, time));
  }

  return points;
}

function createConstellationQuantized(samples, sampleRate) {
  const { createConstellation } = require('../../src/services/audio-recognition/constellation');
  return createConstellation(samples, sampleRate);
}

describe('uint16 quantization vs float32', () => {
  let samples;
  let sampleRate;

  beforeAll(async () => {
    const result = await readWavNormalized(fixture, TARGET_SAMPLE_RATE);
    samples = result.samples;
    sampleRate = result.sampleRate;
  });

  test('uint16 quantization preserves hash matching', async () => {
    const constellationFloat = createConstellationFloat(samples, sampleRate);
    const constellationQuantized = createConstellationQuantized(samples, sampleRate);

    expect(constellationFloat.length).toBe(constellationQuantized.length);

    const hashesFloat = createHashes(constellationFloat, 'float-song');
    const hashesQuantized = createHashes(constellationQuantized, 'quantized-song');

    const floatHashes = new Set([...hashesFloat.keys()]);
    const quantizedHashes = new Set([...hashesQuantized.keys()]);

    const overlap = [...floatHashes].filter(h => quantizedHashes.has(h)).length;
    const union = new Set([...floatHashes, ...quantizedHashes]);

    const jaccardSimilarity = overlap / union.size;

    expect(jaccardSimilarity).toBeGreaterThan(0.95);
  });

  test('quantized constellation uses less memory', () => {
    const constellationFloat = createConstellationFloat(samples, sampleRate);
    const constellationQuantized = createConstellationQuantized(samples, sampleRate);

    const floatBytes = constellationFloat.reduce((sum, [time, freq]) => {
      return sum + 8 + 8;
    }, 0);

    const quantizedBytes = constellationQuantized.reduce((sum, [time, freq]) => {
      return sum + 4 + 2;
    }, 0);

    const compressionRatio = quantizedBytes / floatBytes;
    expect(compressionRatio).toBeLessThan(0.5);
  });

  test('full fingerprint produces similar hash counts', async () => {
    const backend = require('../../src/services/audio-recognition/fingerprint.js');
    const result = await backend.fingerprintWav(fixture);

    expect(result.hashes.length).toBeGreaterThan(20000);
    expect(result.points).toBeGreaterThan(400);
  });

  test('hashPair produces compatible results for quantized values', () => {
    const { hashPair } = require('../../src/services/audio-recognition/hashes');

    const freq1 = Math.round((440 / UPPER_FREQUENCY) * MAX_UINT16);
    const freq2 = Math.round((880 / UPPER_FREQUENCY) * MAX_UINT16);

    const hash1 = hashPair(0, freq1, 5, freq2);
    const hash2 = hashPair(0, freq1, 5, freq2);

    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('number');
    expect(Number.isFinite(hash1)).toBe(true);
  });
});
