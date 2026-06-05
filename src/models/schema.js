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
const { AudioFingerprintHashModel } = require('./audio-fingerprint-hash.model');
const { AudioFingerprintModel } = require('./audio-fingerprint.model');
const {
  ALL_EVENT_PERMISSIONS,
  defaultPermissionsForRole,
} = require('./shared');

async function connectMongo(uri, dbName) {
  mongoose.set('strictQuery', true);
  const opts = { autoIndex: true };
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
  AudioFingerprintHashModel,
  AudioFingerprintModel,
  connectMongo,
  defaultPermissionsForRole,
  ALL_EVENT_PERMISSIONS,
};
