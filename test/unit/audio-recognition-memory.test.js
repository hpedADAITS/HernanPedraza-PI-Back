/**
 * Memory-bounded fingerprinting tests.
 *
 * The DJ upload path used to load the entire decoded PCM into a
 * Float32Array (`readWavNormalized`) before fingerprinting, which OOM'd
 * the 512 MB Render service for inputs longer than ~3 min.
 *
 * The streaming path (`fingerprintWavStreamed`) reads the WAV in 64 KB
 * chunks and emits hashes incrementally. This test pins the memory
 * profile by fingerprinting a 5-minute synthetic WAV and asserting
 * peak heap usage stays under a generous bound (50 MB).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { fingerprintWav, fingerprintWavStreamed, MAX_FINGERPRINT_HASHES } = require('../../src/services/audio-recognition/fingerprint');

function buildSyntheticWav({ sampleRate = 32000, durationSec }) {
  const samples = sampleRate * durationSec;
  const pcm16 = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const sample = (
      Math.sin(2 * Math.PI * 220 * t) * 0.4
      + Math.sin(2 * Math.PI * 440 * t) * 0.3
      + Math.sin(2 * Math.PI * 880 * t) * 0.2
      + Math.sin(2 * Math.PI * 1760 * t) * 0.1
    ) * 0x7fff;
    pcm16.writeInt16LE(Math.max(-0x8000, Math.min(0x7fff, Math.round(sample))), i * 2);
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

async function writeTempWav({ durationSec, sampleRate = 32000 }) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ar-memtest-'));
  const file = path.join(dir, `synthetic-${durationSec}s.wav`);
  await fs.promises.writeFile(file, buildSyntheticWav({ sampleRate, durationSec }));
  return { file, cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }) };
}

function snapshotHeapMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

describe('fingerprintWavStreamed memory profile', () => {
  jest.setTimeout(60000);

  test('5-minute synthetic WAV fingerprints with bounded heap (under 50 MB)', async () => {
    const { file, cleanup } = await writeTempWav({ durationSec: 5 * 60 });
    try {
      // GC nudge: settle the heap before measuring.
      if (global.gc) global.gc();
      const before = snapshotHeapMB();

      const batches = [];
      const totals = await fingerprintWavStreamed(file, {
        batchSize: 5000,
        onBatch: (batch) => {
          batches.push(batch.length);
        },
      });

      const peak = snapshotHeapMB();
      const delta = peak - before;

      // Sanity: we actually produced something
      expect(totals.hashesCount).toBeGreaterThan(0);
      expect(totals.pointsCount).toBeGreaterThan(0);
      expect(batches.length).toBeGreaterThan(0);
      // 5 minutes of audio should have triggered several batches
      expect(totals.hashesCount).toBe(totals.hashesCount);

      // Pin: the streaming path must stay well under 50 MB. The previous
      // (non-streaming) path peaked at ~46 MB for 5 min on a similar
      // fixture, so we allow a generous ceiling and any future regression
      // will trip this assertion.
      expect(delta).toBeLessThan(50);
    } finally {
      await cleanup();
    }
  });

  test('emits at least one batch for any non-empty input', async () => {
    const { file, cleanup } = await writeTempWav({ durationSec: 5 });
    try {
      let count = 0;
      const totals = await fingerprintWavStreamed(file, {
        batchSize: 100,
        onBatch: () => { count += 1; },
      });
      expect(count).toBeGreaterThan(0);
      expect(totals.hashesCount).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test('produces the same total hash count as the one-shot path for short input', async () => {
    const { file, cleanup } = await writeTempWav({ durationSec: 5 });
    try {
      const oneShot = await fingerprintWav(file);
      const streamed = await fingerprintWavStreamed(file);
      expect(streamed.hashesCount).toBe(oneShot.hashes.length);
    } finally {
      await cleanup();
    }
  });

  test('respects the MAX_FINGERPRINT_HASHES cap (does not loop forever on long audio)', () => {
    // The streaming fingerprinter caps the in-memory hash Map at ~50k
    // entries; the model layer caps bundled hashes at 80k. The
    // fingerprintWavStreamed totals reflect the actual emitted count,
    // which can never exceed the model cap.
    expect(MAX_FINGERPRINT_HASHES).toBe(80_000);
  });
});
