const mongoose = require('mongoose');

const { UserModel } = require('./user.model');
const { EventModel } = require('./event.model');
const { EventMemberModel } = require('./event-member.model');
const { ParticipantModel } = require('./participant.model');
const { SongModel } = require('./song.model');
const { VoteModel } = require('./vote.model');
const { EventActionLogModel } = require('./event-action-log.model');
const {
  ALL_EVENT_PERMISSIONS,
  defaultPermissionsForRole,
} = require('./shared');

async function hasEventPermission(user, eventId, permission) {
  if (user.role === 'ADMIN') return true;
  const member = await EventMemberModel.findOne({ eventId, userId: user._id })
    .select({ permissions: 1 })
    .lean();
  if (!member) return false;
  return (
    Array.isArray(member.permissions) && member.permissions.includes(permission)
  );
}

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
  connectMongo,
  hasEventPermission,
  defaultPermissionsForRole,
  ALL_EVENT_PERMISSIONS,
};
