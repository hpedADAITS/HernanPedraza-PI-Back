const authService = require('./auth.service');
const eventsService = require('./events.service');
const songsService = require('./songs.service');
const participantsService = require('./participants.service');
const attendeeSessionService = require('./attendee-session.service');
const votesService = require('./votes.service');
const emailService = require('./email.service');

module.exports = {
  authService,
  eventsService,
  songsService,
  participantsService,
  attendeeSessionService,
  votesService,
  emailService,
};
