const path = require('path');

const __root = path.resolve(__dirname, '../../../..');
const fixture = path.join(__root, 'audio-recognition-service-node/data/recording1.wav');

describe('audio recognition', () => {
  test('backend fingerprint output matches source recognizer', () => {
    const source = require(path.join(__root, 'audio-recognition-service-node/src/fingerprint.js'));
    const backend = require('../../src/services/audio-recognition/fingerprint.js');

    expect(backend.fingerprintWav(fixture).hashes).toEqual(
      source.fingerprintWav(fixture).hashes,
    );
  });
});
