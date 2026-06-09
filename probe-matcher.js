const path = require('path');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
process.env.MONGOMS_DISTRO = 'ubuntu-22.04';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

(async () => {
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;
  process.env.DB_NAME = 'probe';

  const { connectMongo, AudioFingerprintModel, AudioTrackModel, EventModel, UserModel } = require('./src/models/schema');
  const { matchHashes } = require('./src/services/audio-recognition/ram-matcher');
  const { StreamingFingerprinter } = require('./src/services/audio-recognition/streaming');
  const { TARGET_SAMPLE_RATE } = require('./src/services/audio-recognition/wav');
  const { resampleLinear } = require('./src/services/audio-recognition/wav');
  const { pcm16WavToFloat32AtTarget } = require('./test/helpers/audioFixtures');

  await connectMongo();

  // Create user, event
  const owner = await UserModel.create({
    email: 'probe@probe.com',
    passwordHash: 'x',
    displayName: 'Probe',
    role: 'DJ',
    emailVerified: true,
  });
  const event = await EventModel.create({
    name: 'Probe Event',
    ownerId: owner._id,
    accessCode: 'PROBE1',
    state: 'LIVE',
    startsAt: new Date(),
  });
  console.log('eventId:', event._id.toString());
  console.log('ownerId:', owner._id.toString());
  console.log('owner authTokenVersion:', owner.authTokenVersion);

  // Create track
  const track = await AudioTrackModel.create({
    eventId: event._id,
    title: 'enc-text:v1:0.AAAA.BBBB.CCCC', // Simulated stale cipher
    artist: 'enc-text:v1:0.AAAA.BBBB.CCCC',
    coverUrl: null,
    uploadedBy: owner._id,
    duration: 10,
    sampleRate: TARGET_SAMPLE_RATE,
    pointsCount: 0,
    hashesCount: 0,
  });
  console.log('trackId:', track._id.toString());

  // Create fingerprint with hashes
  const fs = require('fs');
  const wavPath = path.resolve(__dirname, '../simple_house_140bpm_60s.wav');
  const wav = fs.readFileSync(wavPath);
  const samples = pcm16WavToFloat32AtTarget(wav, 44100);

  const fingerprinter = new StreamingFingerprinter(TARGET_SAMPLE_RATE);
  const allHashes = [];
  const chunkSize = TARGET_SAMPLE_RATE;
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.subarray(offset, offset + chunkSize);
    const hashes = fingerprinter.process(chunk) ?? [];
    allHashes.push(...hashes);
  }
  console.log('hashes generated:', allHashes.length);
  console.log('first hash:', allHashes[0]);

  // Write fingerprint using codec
  const { encodeHashRows } = require('./src/services/audio-recognition/fingerprint-codec');
  const hashData = encodeHashRows(allHashes);
  await AudioFingerprintModel.create({
    eventId: event._id,
    trackId: track._id,
    sampleRate: TARGET_SAMPLE_RATE,
    duration: 10,
    pointsCount: 0,
    hashesCount: allHashes.length,
    hashData,
  });
  console.log('fingerprint created');

  // Match
  const matches = await matchHashes(event._id.toString(), allHashes);
  console.log('matches:', JSON.stringify(matches, null, 2));

  await mongoose.disconnect();
  await mongoServer.stop();
  process.exit(0);
})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
