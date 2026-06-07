const authService = require('./auth.service');
const eventsService = require('./events.service');
const songsService = require('./songs.service');
const participantsService = require('./participants.service');
const attendeeSessionService = require('./attendee-session.service');
const votesService = require('./votes.service');
const emailService = require('./email.service');
const friendsService = require('./friends.service');
const { audioTracksService, sharedRamMatcher } = require('./audio-tracks.service');
const eventPermissionsService = require('./event-permissions.service');

module.exports = {
  authService,
  eventsService,
  songsService,
  participantsService,
  attendeeSessionService,
  votesService,
  emailService,
  friendsService,
  audioTracksService,
  eventPermissionsService,
  sharedRamMatcher,
};
