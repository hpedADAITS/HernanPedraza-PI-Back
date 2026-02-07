/**
 * Centralizado de todas las constantes de eventTypes que se requieren en la app.
 */

const httpStatus = require("./httpStatus");
const messages = require("./messages");
const {
  EVENT_STATES,
  EVENT_ROLES,
  USER_ROLES,
  SONG_STATUS,
  EVENT_PERMISSIONS,
  ACTION_LOG_TYPES,
  SOCKET_EVENTS,
} = require("./eventTypes");

module.exports = {
  httpStatus,
  messages,
  EVENT_STATES,
  EVENT_ROLES,
  USER_ROLES,
  SONG_STATUS,
  EVENT_PERMISSIONS,
  ACTION_LOG_TYPES,
  SOCKET_EVENTS,
};
