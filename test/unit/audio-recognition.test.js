const path = require('path');

const __root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__root, 'repo', 'simple_house_140bpm_60s.wav');
const { TARGET_SAMPLE_RATE } = require('../../src/services/audio-recognition/wav');

function snapshotHeapMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

describe('fingerprintWavStreamed', () => {
  test('produces valid fingerprints from the real 60s fixture', async () => {
    const { fingerprintWavStreamed } = require('../../src/services/audio-recognition/fingerprint');

    const result = await fingerprintWavStreamed(fixture);

    expect(result.hashesCount).toBeGreaterThan(20000);
    expect(result.sampleRate).toBe(TARGET_SAMPLE_RATE);
    expect(result.pointsCount).toBeGreaterThan(400);
    expect(result.duration).toBeGreaterThan(10);
  });

  test('memory stays bounded when fingerprinting the 60s fixture (under 50 MB delta)', async () => {
    const { fingerprintWavStreamed } = require('../../src/services/audio-recognition/fingerprint');

    if (global.gc) global.gc();
    const before = snapshotHeapMB();

    await fingerprintWavStreamed(fixture);

    const peak = snapshotHeapMB();
    const delta = peak - before;

    expect(delta).toBeLessThan(50);
  });

  test('batches are emitted during processing', async () => {
    const { fingerprintWavStreamed } = require('../../src/services/audio-recognition/fingerprint');

    const batchCounts = [];
    await fingerprintWavStreamed(fixture, {
      batchSize: 5000,
      onBatch: (batch) => { batchCounts.push(batch.length); },
    });

    expect(batchCounts.length).toBeGreaterThan(0);
    batchCounts.forEach((n) => expect(n).toBeLessThanOrEqual(5000));
  });

  test('MAX_FINGERPRINT_HASHES cap is honoured', async () => {
    const { fingerprintWavStreamed, MAX_FINGERPRINT_HASHES } = require('../../src/services/audio-recognition/fingerprint');
    expect(MAX_FINGERPRINT_HASHES).toBe(80_000);

    const result = await fingerprintWavStreamed(fixture);
    expect(result.capped).toBe(true);
    expect(result.hashesCount).toBeLessThanOrEqual(MAX_FINGERPRINT_HASHES);
  });
});
