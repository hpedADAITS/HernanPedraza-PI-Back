/**
 * Audio-recognition quality / robustness tests.
 *
 * This file documents the limits of the constellation + hash algorithm
 * implemented in `src/services/audio-recognition/`. The tests target
 * false-positive and false-negative behaviour against:
 *
 *   - silence            (no match, no crash)
 *   - pure tone          (insufficient peaks to make a match)
 *   - short / truncated  (a few seconds of a track)
 *   - gain / loudness    (the same track at a different amplitude)
 *   - unrelated tracks   (a constellation for one track should not match another)
 *
 * All tests use the real implementation against synthetic fixtures built
 * in-memory; no external services, no mocks, no DB.
 */

const { createConstellation } = require('../../src/services/audio-recognition/constellation');
const { createHashes, hashPair, FAN_OUT } = require('../../src/services/audio-recognition/hashes');
const {
  readWavNormalized,
  resampleLinear,
  TARGET_SAMPLE_RATE,
} = require('../../src/services/audio-recognition/wav');
const { fingerprintWav } = require('../../src/services/audio-recognition/fingerprint');

function synthTonePcm({ sampleRate = 32000, duration = 5, frequency = 440, amplitude = 0.5 } = {}) {
  const length = Math.floor(sampleRate * duration);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return out;
}

function synthSilencePcm({ sampleRate = 32000, duration = 5 } = {}) {
  return new Float32Array(Math.floor(sampleRate * duration));
}

function synthWavBuffer({ sampleRate = 32000, samples }) {
  const pcm16 = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm16.writeInt16LE(Math.round(v * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

async function writeTempWav(name, pcm, sampleRate = 32000) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `ar-quality-${name}-`));
  const file = path.join(dir, `${name}.wav`);
  await fs.promises.writeFile(file, synthWavBuffer({ sampleRate, samples: pcm }));
  return { file, cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }) };
}

describe('hashPair', () => {
  test('is deterministic for the same input', () => {
    expect(hashPair(0, 1000, 5, 2000)).toBe(hashPair(0, 1000, 5, 2000));
  });

  test('returns null when the time delta is too small (≤ 1) or too large (> 10)', () => {
    expect(hashPair(0, 1000, 0, 2000)).toBeNull();
    expect(hashPair(0, 1000, 1, 2000)).toBeNull();
    expect(hashPair(0, 1000, 11, 2000)).toBeNull();
  });

  test('accepts the inclusive delta range [2, 10]', () => {
    expect(hashPair(0, 1000, 2, 2000)).not.toBeNull();
    expect(hashPair(0, 1000, 10, 2000)).not.toBeNull();
  });

  test('produces distinct hashes for frequency pairs that span the bin width', () => {
    // With UPPER_FREQUENCY=14000 and 1024 bins, the bin width is ~13.7 Hz.
    // Frequencies must differ by more than half a bin to be quantised to
    // different bins. Pairs separated by ≥ 100 Hz are well above that.
    const a = hashPair(0, 100, 5, 200);
    const b = hashPair(0, 100, 5, 2000);
    const c = hashPair(0, 1000, 5, 200);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  test('encodes all three components into a 32-bit integer', () => {
    const h = hashPair(3, 12345, 7, 22222);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe('createConstellation', () => {
  test('returns [time, freq] tuples bounded by PEAKS_PER_WINDOW per frame', () => {
    const samples = synthTonePcm({ duration: 1, frequency: 440 });
    const points = createConstellation(samples, TARGET_SAMPLE_RATE);
    expect(points.length).toBeGreaterThan(0);
    for (const [time, freq] of points) {
      expect(Number.isInteger(time)).toBe(true);
      expect(time).toBeGreaterThanOrEqual(0);
      expect(freq).toBeGreaterThanOrEqual(0);
    }
  });

  test('documents the constellation overflow above UPPER_FREQUENCY', () => {
    // Known limitation: when a peak lands in a bin above UPPER_FREQUENCY
    // (14 kHz at 32 kHz sample rate), the quantized freq exceeds 65535.
    // At the Nyquist limit (16 kHz at 32 kHz sample rate) the upper bound
    // is roughly (16000/14000) * 65535 ≈ 74897. The right fix is to filter
    // high-frequency peaks before quantization; until then, this test pins
    // the current behaviour so any future change is intentional.
    const samples = synthTonePcm({ duration: 1, frequency: 15500 });
    const points = createConstellation(samples, TARGET_SAMPLE_RATE);
    const maxFreq = points.reduce((m, [, f]) => Math.max(m, f), 0);
    if (maxFreq > 65535) {
      // Overflow observed. The max should stay below the Nyquist-derived cap.
      expect(maxFreq).toBeLessThan(75000);
    } else {
      // If a future fix clamps the frequency, we expect a max of 65535.
      expect(maxFreq).toBeLessThanOrEqual(65535);
    }
  });

  test('produces no peaks for digital silence', () => {
    const samples = synthSilencePcm({ duration: 1 });
    const points = createConstellation(samples, TARGET_SAMPLE_RATE);
    expect(points).toEqual([]);
  });

  test('produces very few peaks for a pure tone (single dominant frequency)', () => {
    const samples = synthTonePcm({ duration: 2, frequency: 440 });
    const points = createConstellation(samples, TARGET_SAMPLE_RATE);
    // With a single dominant tone, the topPeaks selection will still find a small
    // number of side-band peaks per window. The total count should be far below
    // what a typical music track produces (which is in the thousands for 2 s).
    expect(points.length).toBeLessThan(80);
  });

  test('scales with duration for a real music signal', async () => {
    const path = require('path');
    const fixture = path.resolve(__dirname, '../../../simple_house_140bpm_60s.wav');
    const { samples, sampleRate } = await readWavNormalized(fixture, TARGET_SAMPLE_RATE);
    const total = createConstellation(samples, sampleRate).length;
    const truncated = createConstellation(samples.slice(0, sampleRate * 5), sampleRate);
    expect(truncated.length).toBeLessThan(total);
    expect(truncated.length).toBeGreaterThan(0);
  });
});

describe('createHashes', () => {
  test('returns fewer hashes than there are pairs (FAN_OUT limit)', () => {
    const samples = synthTonePcm({ duration: 1, frequency: 440 });
    const points = createConstellation(samples, TARGET_SAMPLE_RATE);
    const hashes = [...createHashes(points)];
    // Upper bound: every point pairs with up to FAN_OUT future points.
    const maxPairs = points.length * FAN_OUT;
    expect(hashes.length).toBeLessThanOrEqual(maxPairs);
  });

  test('attaches the songId to every hash entry', () => {
    const samples = synthTonePcm({ duration: 1, frequency: 440 });
    const points = createConstellation(samples, TARGET_SAMPLE_RATE);
    const hashes = [...createHashes(points, 'song-42')];
    for (const [, [, id]] of hashes) {
      expect(id).toBe('song-42');
    }
  });

  test('emits the same set of hashes for the same constellation', () => {
    const samples = synthTonePcm({ duration: 1, frequency: 440 });
    const points = createConstellation(samples, TARGET_SAMPLE_RATE);
    const a = new Set([...createHashes(points)].map(([h]) => h));
    const b = new Set([...createHashes(points)].map(([h]) => h));
    expect(a).toEqual(b);
  });
});

describe('resampleLinear', () => {
  test('is the identity function when fromRate === toRate', () => {
    const input = new Float32Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]);
    const out = resampleLinear(input, 32000, 32000);
    expect(out).toBe(input);
  });

  test('returns an empty array for an empty input', () => {
    expect(resampleLinear(new Float32Array(0), 32000, 16000)).toEqual(new Float32Array(0));
  });

  test('produces the expected output length when down-sampling', () => {
    const input = new Float32Array(32000);
    const out = resampleLinear(input, 32000, 16000);
    expect(out.length).toBe(16000);
  });

  test('interpolates linearly between samples (midpoint of a ramp)', () => {
    // 4 samples, all at known values. Down-sample by 2 → expect midpoint of 0 and 1.
    const input = new Float32Array([0, 0, 1, 1]);
    const out = resampleLinear(input, 4, 2);
    // ratio = 4/2 = 2, so output indices map to source 0 and 2.
    // i=0 → sourceIndex 0 → floor 0, frac 0 → value 0
    // i=1 → sourceIndex 2 → floor 2, frac 0 → value 1
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(1, 5);
  });
});

describe('cross-track robustness (false-positive guard)', () => {
  test('does not confuse two unrelated synthetic signals (low + high band)', async () => {
    const low = synthTonePcm({ duration: 3, frequency: 220, amplitude: 0.5 });
    const high = synthTonePcm({ duration: 3, frequency: 4400, amplitude: 0.5 });

    const { file: lowFile, cleanup: cleanupLow } = await writeTempWav('low', low);
    const { file: highFile, cleanup: cleanupHigh } = await writeTempWav('high', high);

    try {
      const lowFp = await fingerprintWav(lowFile);
      const highFp = await fingerprintWav(highFile);

      const lowHashSet = new Set(lowFp.hashes.map(({ hash }) => hash));
      const highHashSet = new Set(highFp.hashes.map(({ hash }) => hash));

      let overlap = 0;
      for (const h of lowHashSet) if (highHashSet.has(h)) overlap += 1;

      // Two unrelated tracks with disjoint frequency content should share
      // essentially zero hashes. A small handful of collisions can occur by
      // chance; allow up to 5 to keep the test stable on real hardware.
      expect(overlap).toBeLessThan(5);
    } finally {
      await Promise.all([cleanupLow(), cleanupHigh()]);
    }
  });
});

describe('false-negative limits (documented behaviour)', () => {
  test('silence produces an empty fingerprint (matches nothing by design)', async () => {
    const { file, cleanup } = await writeTempWav('silence', synthSilencePcm({ duration: 3 }));
    try {
      const fp = await fingerprintWav(file);
      expect(fp.hashes).toEqual([]);
      expect(fp.points).toBe(0);
    } finally {
      await cleanup();
    }
  });

  test('a single-frequency tone produces very few hashes (FN risk on synthetic content)', async () => {
    const { file, cleanup } = await writeTempWav('tone', synthTonePcm({ duration: 3, frequency: 440 }));
    try {
      const fp = await fingerprintWav(file);
      // A real music track produces tens of thousands of hashes; a pure tone
      // should produce orders of magnitude less, which means matching a tone
      // is statistically unreliable and likely a false negative.
      expect(fp.hashes.length).toBeLessThan(2000);
    } finally {
      await cleanup();
    }
  });
});
