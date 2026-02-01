// Import all MongoDB models from mongo_schema.ts
// This file serves as a central export point for all models

const {
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
} = require("../mongo_schema");

module.exports = {
  // Models
  UserModel,
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  VoteModel,
  EventActionLogModel,

  // Database functions
  connectMongo,

  // Utility functions
  hasEventPermission,
  defaultPermissionsForRole,
};
