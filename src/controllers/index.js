const authController = require('./auth.controller');
const audioTracksController = require('./audio-tracks.controller');
const eventsController = require('./events.controller');
const songsController = require('./songs.controller');
const participantsController = require('./participants.controller');
const attendeeSessionController = require('./attendee-session.controller');
const votesController = require('./votes.controller');
const friendsController = require('./friends.controller');

module.exports = {
  authController,
  audioTracksController,
  eventsController,
  songsController,
  participantsController,
  attendeeSessionController,
  votesController,
  friendsController,
};
