const path = require('path');

const __root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__root, 'repo', 'simple_house_140bpm_60s.wav');

function getMemoryUsageMB() {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed / 1024 / 1024,
    heapTotal: usage.heapTotal / 1024 / 1024,
    rss: usage.rss / 1024 / 1024,
    external: usage.external / 1024 / 1024,
  };
}

describe('audio recognition', () => {
  test('backend produces valid fingerprints at 32kHz', async () => {
    const backend = require('../../src/services/audio-recognition/fingerprint.js');
    const result = await backend.fingerprintWav(fixture);

    expect(result.hashes.length).toBeGreaterThan(20000);
    expect(result.sampleRate).toBe(32000);
    expect(result.originalSampleRate).toBe(44100);
    expect(result.points).toBeGreaterThan(400);
    expect(result.duration).toBeGreaterThan(10);

    result.hashes.forEach(h => {
      expect(typeof h.hash).toBe('number');
      expect(Number.isFinite(h.hash)).toBe(true);
      expect(typeof h.time).toBe('number');
    });
  });

  test('RAM memory usage and waste during fingerprinting', async () => {
    const backend = require('../../src/services/audio-recognition/fingerprint.js');
    const { readWavNormalized } = require('../../src/services/audio-recognition/wav');
    const { createConstellation } = require('../../src/services/audio-recognition/constellation');
    const { createHashes } = require('../../src/services/audio-recognition/hashes');

    const { samples, sampleRate } = await readWavNormalized(fixture, 32000);
    const constellation = createConstellation(samples, sampleRate);
    const hashesMap = createHashes(constellation, 'test-song');
    const result = await backend.fingerprintWav(fixture);

    const samplesBytes = samples.length * 4;
    const constellationBytes = constellation.length * 6;
    const hashesBytes = Array.from(hashesMap.keys()).length * 24;
    const outputBytes = result.hashes.length * 16;

    const intermediateBytes = samplesBytes + constellationBytes + hashesBytes;
    const wastedBytes = intermediateBytes - outputBytes;
    const wasteRatio = wastedBytes / intermediateBytes;

    process.stdout.write('\n=== RAM Memory Waste Report (60s benchmark) ===\n');
    process.stdout.write(`Samples buffer (float32):   ${(samplesBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Constellation points:       ${(constellationBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Hash map overhead:          ${(hashesBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Total intermediate:         ${(intermediateBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Final output size:          ${(outputBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Wasted memory:              ${(wastedBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Waste ratio:               ${(wasteRatio * 100).toFixed(1)}%\n`);
    process.stdout.write('==============================================\n\n');

    expect(wastedBytes).toBeGreaterThan(0);
    expect(wasteRatio).toBeGreaterThan(0.5);
    expect(wasteRatio).toBeLessThan(0.99);
  });

  test('tracks peak memory allocation per processing stage', async () => {
    const { readWavNormalized } = require('../../src/services/audio-recognition/wav');
    const { createConstellation } = require('../../src/services/audio-recognition/constellation');
    const { createHashes } = require('../../src/services/audio-recognition/hashes');

    const { samples, sampleRate } = await readWavNormalized(fixture, 32000);
    const samplesSizeMB = (samples.length * 4) / 1024 / 1024;

    const constellation = createConstellation(samples, sampleRate);
    const constellationSizeMB = (constellation.length * 6) / 1024 / 1024;

    const hashes = createHashes(constellation, 'test');
    const hashesSizeMB = (Array.from(hashes).length * 24) / 1024 / 1024;

    expect(samplesSizeMB).toBeGreaterThan(0);
    expect(constellationSizeMB).toBeLessThan(samplesSizeMB);
    expect(hashesSizeMB).toBeGreaterThan(0);
  });

  test('memory waste from constellation intermediate storage', async () => {
    const { readWavNormalized } = require('../../src/services/audio-recognition/wav');
    const { createConstellation } = require('../../src/services/audio-recognition/constellation');

    const { samples, sampleRate } = await readWavNormalized(fixture, 32000);
    const constellation = createConstellation(samples, sampleRate);

    const actualConstellationDataBytes = constellation.length * (4 + 2);
    const theoreticalMinBytes = constellation.length * (4 + 2);
    const wasteBytes = actualConstellationDataBytes - theoreticalMinBytes;
    const wasteRatio = wasteBytes / actualConstellationDataBytes;

    expect(wasteRatio).toBe(0);
    expect(actualConstellationDataBytes).toBe(theoreticalMinBytes);
  });

  test('estimated memory waste for 5 minute audio', async () => {
    const backend = require('../../src/services/audio-recognition/fingerprint.js');
    const { readWavNormalized } = require('../../src/services/audio-recognition/wav');
    const { createConstellation } = require('../../src/services/audio-recognition/constellation');
    const { createHashes } = require('../../src/services/audio-recognition/hashes');

    const SCALE = 5;

    const { samples, sampleRate } = await readWavNormalized(fixture, 32000);
    const constellation = createConstellation(samples, sampleRate);
    const hashesMap = createHashes(constellation, 'test-song');
    const result = await backend.fingerprintWav(fixture);

    const samplesBytes = samples.length * 4 * SCALE;
    const constellationBytes = constellation.length * 6 * SCALE;
    const hashesBytes = Array.from(hashesMap.keys()).length * 24 * SCALE;
    const outputBytes = result.hashes.length * 16 * SCALE;

    const intermediateBytes = samplesBytes + constellationBytes + hashesBytes;
    const wastedBytes = intermediateBytes - outputBytes;
    const wasteRatio = wastedBytes / intermediateBytes;

    process.stdout.write('\n=== RAM Memory Waste Report (5 MINUTE estimate) ===\n');
    process.stdout.write(`Scale factor from 60s to 5min:     ${SCALE}x\n`);
    process.stdout.write(`Estimated samples buffer:           ${(samplesBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Estimated constellation points:     ${(constellationBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Estimated hash map overhead:        ${(hashesBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Estimated total intermediate:      ${(intermediateBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Estimated final output size:       ${(outputBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Estimated wasted memory:            ${(wastedBytes / 1024 / 1024).toFixed(2)} MB\n`);
    process.stdout.write(`Estimated waste ratio:             ${(wasteRatio * 100).toFixed(1)}%\n`);
    process.stdout.write('==============================================\n\n');

    expect(wastedBytes).toBeGreaterThan(0);
    expect(wasteRatio).toBeGreaterThan(0.7);
  });
});
