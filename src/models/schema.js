const mongoose = require('mongoose');

const { UserModel } = require('./user.model');
const { EventModel } = require('./event.model');
const { EventMemberModel } = require('./event-member.model');
const { ParticipantModel } = require('./participant.model');
const { SongModel } = require('./song.model');
const { VoteModel } = require('./vote.model');
const { EventActionLogModel } = require('./event-action-log.model');
const { AudioTrackModel } = require('./audio-track.model');
const { AudioFingerprintPointModel } = require('./audio-fingerprint-point.model');
const { AudioFingerprintModel } = require('./audio-fingerprint.model');
const {
  ALL_EVENT_PERMISSIONS,
  defaultPermissionsForRole,
} = require('./shared');

async function connectMongo(uri, dbName) {
  mongoose.set('strictQuery', true);
  const opts = {
    autoIndex: true,
    // Render free tier: keep the connection pool small. Mongoose's default
    // is 100, which is wasteful on 0.1 vCPU / 512 MB. 5 is enough for a
    // single-event DJ app; 10 leaves headroom for the live phone-mic path.
    maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 10,
    minPoolSize: 1,
    // Fail fast on cold start so we don't hang the health check.
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };
  if (dbName) opts.dbName = dbName;
  await mongoose.connect(uri, opts);
  return mongoose.connection;
}

module.exports = {
  UserModel,
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  VoteModel,
  EventActionLogModel,
  AudioTrackModel,
  AudioFingerprintPointModel,
  AudioFingerprintModel,
  connectMongo,
  defaultPermissionsForRole,
  ALL_EVENT_PERMISSIONS,
};
