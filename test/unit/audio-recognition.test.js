const path = require('path');

const __root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__root, 'audio-recognition-service-node/data/recording1.wav');

describe('audio recognition', () => {
  test('backend produces valid fingerprints at 32kHz', async () => {
    const backend = require('../../src/services/audio-recognition/fingerprint.js');
    const result = await backend.fingerprintWav(fixture);

    expect(result.hashes.length).toBeGreaterThan(20000);
    expect(result.sampleRate).toBe(32000);
    expect(result.originalSampleRate).toBe(48000);
    expect(result.points).toBeGreaterThan(400);
    expect(result.duration).toBeGreaterThan(10);

    // All hashes should be valid numbers
    result.hashes.forEach(h => {
      expect(typeof h.hash).toBe('number');
      expect(Number.isFinite(h.hash)).toBe(true);
      expect(typeof h.time).toBe('number');
    });
  });
});
