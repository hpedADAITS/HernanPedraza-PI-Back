const mongoose = require('mongoose');

const { UserModel } = require('./user.model');
const { EventModel } = require('./event.model');
const { EventMemberModel } = require('./event-member.model');
const { ParticipantModel } = require('./participant.model');
const { SongModel } = require('./song.model');
const { VoteModel } = require('./vote.model');
const { AudioTrackModel } = require('./audio-track.model');
const { AudioFingerprintModel } = require('./audio-fingerprint.model');
const {
  ALL_EVENT_PERMISSIONS,
  defaultPermissionsForRole,
} = require('./shared');

function stripMongoDbPath(uri) {
  if (!uri || typeof uri !== 'string') return uri;
  /* Find the host/path boundary: the first '/' after the scheme's '//'.
     This is the slash that separates host (with optional credentials and
     comma-separated replica set hosts) from the default auth db path.
     The WHATWG URL parser does not handle comma-separated host lists, so
     we parse it by hand. */
  const schemeMatch = uri.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*:\/\/)/);
  if (!schemeMatch) return uri;
  const afterScheme = schemeMatch[0].length;
  const pathStart = uri.indexOf('/', afterScheme);
  if (pathStart < 0) return uri;

  const queryStart = uri.indexOf('?', afterScheme);
  const pathEnd = queryStart < 0 ? uri.length : queryStart;

  /* Keep an empty path ("/" or "") untouched. */
  if (pathEnd === pathStart + 1 && uri[pathStart] === '/') return uri;
  if (pathEnd === pathStart) return uri;

  /* Replace the db portion with a single '/'. */
  return uri.slice(0, pathStart + 1) + uri.slice(pathEnd);
}

async function connectMongo(uri, dbName) {
  mongoose.set('strictQuery', true);
  /* When dbName is supplied we strip any path component from the URI.
     Mongoose raises "db already exists with different case" if the URI's
     embedded db and opts.dbName differ only in case — common when one is
     set in .env and the other in the Render dashboard. Stripping the path
     leaves opts.dbName as the single source of truth. */
  const cleanUri = dbName ? stripMongoDbPath(uri) : uri;
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
  if (dbName) opts.dbName = String(dbName).toLowerCase();
  await mongoose.connect(cleanUri, opts);
  return mongoose.connection;
}

module.exports = {
  UserModel,
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  VoteModel,
  AudioTrackModel,
  AudioFingerprintModel,
  connectMongo,
  stripMongoDbPath,
  defaultPermissionsForRole,
  ALL_EVENT_PERMISSIONS,
};
