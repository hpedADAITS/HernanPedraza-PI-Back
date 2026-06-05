const fs = require('fs');
const os = require('os');
const path = require('path');

const { fingerprintWavStreamed, MAX_FINGERPRINT_HASHES } = require('../../src/services/audio-recognition/fingerprint');
const { TARGET_SAMPLE_RATE } = require('../../src/services/audio-recognition/wav');

function snapshotHeapMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

async function writeSyntheticWavIncremental({ sampleRate = TARGET_SAMPLE_RATE, durationSec, filePath }) {
  const bytesPerSample = 2;
  const channels = 1;
  const bytesPerFrame = bytesPerSample * channels;
  const totalSamples = sampleRate * durationSec;
  const pcmBytes = totalSamples * bytesPerSample;
  const fileSize = 44 + pcmBytes;

  const fd = await fs.promises.open(filePath, 'w');
  try {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize - 8, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * bytesPerFrame, 28);
    header.writeUInt16LE(bytesPerSample * 8, 32);
    header.writeUInt16LE(bytesPerSample * 8, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBytes, 40);
    // pwrite semantics: writing at a specific position does NOT advance the
    // position pointer, so the subsequent unwritten-position PCM writes would
    // start at offset 0 and overwrite the header. Pass null to let the kernel
    // use the current position (write(2)) and advance the offset.
    await fd.write(header, 0, 44, null);

    const CHUNK_SAMPLES = 8192;
    let sampleIndex = 0;
    while (sampleIndex < totalSamples) {
      const chunkSamples = Math.min(CHUNK_SAMPLES, totalSamples - sampleIndex);
      const pcm = Buffer.alloc(chunkSamples * bytesPerSample);
      for (let i = 0; i < chunkSamples; i++) {
        const t = (sampleIndex + i) / sampleRate;
        const s = (
          Math.sin(2 * Math.PI * 220 * t) * 0.4
          + Math.sin(2 * Math.PI * 440 * t) * 0.3
          + Math.sin(2 * Math.PI * 880 * t) * 0.2
          + Math.sin(2 * Math.PI * 1760 * t) * 0.1
        ) * 0x7fff;
        pcm.writeInt16LE(Math.max(-0x8000, Math.min(0x7fff, Math.round(s))), i * 2);
      }
      await fd.write(pcm, 0, pcm.length, null);
      sampleIndex += chunkSamples;
    }
  } finally {
    await fd.close();
  }
}

async function makeTempFile(name) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), name));
  return dir;
}

describe('fingerprintWavStreamed memory profile', () => {
  jest.setTimeout(60000);

  test('5-minute synthetic WAV fingerprints with bounded heap (under 50 MB)', async () => {
    const tmpDir = await makeTempFile('ar-mem-');
    const file = path.join(tmpDir, '5min.wav');
    try {
      await writeSyntheticWavIncremental({ durationSec: 5 * 60, sampleRate: TARGET_SAMPLE_RATE, filePath: file });

      if (global.gc) global.gc();
      const before = snapshotHeapMB();

      const batches = [];
      const totals = await fingerprintWavStreamed(file, {
        batchSize: 5000,
        onBatch: (batch) => { batches.push(batch.length); },
      });

      const peak = snapshotHeapMB();
      const delta = peak - before;

      expect(totals.hashesCount).toBeGreaterThan(0);
      expect(totals.pointsCount).toBeGreaterThan(0);
      expect(batches.length).toBeGreaterThan(0);
      expect(delta).toBeLessThan(50);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('short synthetic WAV emits at least one batch', async () => {
    const tmpDir = await makeTempFile('ar-mem-short-');
    const file = path.join(tmpDir, 'short.wav');
    try {
      await writeSyntheticWavIncremental({ durationSec: 5, sampleRate: TARGET_SAMPLE_RATE, filePath: file });

      let count = 0;
      const totals = await fingerprintWavStreamed(file, {
        batchSize: 100,
        onBatch: () => { count += 1; },
      });

      expect(count).toBeGreaterThan(0);
      expect(totals.hashesCount).toBeGreaterThan(0);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('streaming path agrees with one-shot for short synthetic WAV', async () => {
    const { fingerprintWav } = require('../../src/services/audio-recognition/fingerprint');
    const tmpDir = await makeTempFile('ar-mem-compare-');
    const file = path.join(tmpDir, 'compare.wav');
    try {
      await writeSyntheticWavIncremental({ durationSec: 5, sampleRate: TARGET_SAMPLE_RATE, filePath: file });

      const oneShot = await fingerprintWav(file);
      const streamed = await fingerprintWavStreamed(file);

      expect(streamed.hashesCount).toBe(oneShot.hashes.length);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('MAX_FINGERPRINT_HASHES cap is 80_000', () => {
    expect(MAX_FINGERPRINT_HASHES).toBe(80_000);
  });
});
