const path = require('path');

const fixture = path.join(
  __dirname,
  '../../../audio-recognition-service-node/data/recording1.wav',
);

describe('audio recognition', () => {
  test('backend fingerprint output matches source recognizer', () => {
    const source = require('../../../audio-recognition-service-node/src/fingerprint');
    const backend = require('../../src/services/audio-recognition/fingerprint');

    expect(backend.fingerprintWav(fixture).hashes).toEqual(
      source.fingerprintWav(fixture).hashes,
    );
  });
});
