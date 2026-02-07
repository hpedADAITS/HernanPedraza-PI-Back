// Import all MongoDB models from schema.js
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
  ALL_EVENT_PERMISSIONS,
} = require("./schema");

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
  ALL_EVENT_PERMISSIONS,
};
