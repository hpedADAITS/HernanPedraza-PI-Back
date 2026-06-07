const fs = require('fs');
const path = require('path');

const ROUTE_FILES = {
  '/api/v1/auth': '../../src/routes/auth.routes.js',
  '/api/v1/events': '../../src/routes/events.routes.js',
  '/api/v1/participants': '../../src/routes/participants.routes.js',
  '/api/v1/songs': '../../src/routes/songs.routes.js',
  '/api/v1/votes': '../../src/routes/votes.routes.js',
  '/api/v1/attendee-session': '../../src/routes/attendee-session.routes.js',
};

const ROUTES_USED_BY_FRONTEND = [
  ['POST', '/api/v1/auth/register'],
  ['POST', '/api/v1/auth/login'],
  ['POST', '/api/v1/auth/logout'],
  ['GET', '/api/v1/auth/me'],
  ['PATCH', '/api/v1/auth/me'],
  ['PATCH', '/api/v1/auth/me/picture'],
  ['POST', '/api/v1/auth/verify-email'],
  ['GET', '/api/v1/auth/verify-email/:token'],
  ['POST', '/api/v1/events'],
  ['GET', '/api/v1/events'],
  ['GET', '/api/v1/events/mine/active'],
  ['GET', '/api/v1/events/:eventId'],
  ['PUT', '/api/v1/events/:eventId'],
  ['GET', '/api/v1/events/access/:accessCode'],
  ['POST', '/api/v1/events/:eventId/start'],
  ['POST', '/api/v1/events/:eventId/end'],
  ['POST', '/api/v1/events/:eventId/cancel'],
  ['POST', '/api/v1/events/:eventId/regenerate-code'],
  ['GET', '/api/v1/events/:eventId/participants'],
  ['GET', '/api/v1/events/:eventId/phone-microphone-link'],
  ['POST', '/api/v1/events/:eventId/phone-microphone/connect'],
  ['POST', '/api/v1/events/:eventId/audio-tracks'],
  ['GET', '/api/v1/events/:eventId/audio-tracks'],
  ['DELETE', '/api/v1/events/:eventId/audio-tracks/:trackId'],
  ['POST', '/api/v1/events/:eventId/audio-match'],
  ['POST', '/api/v1/participants/nickname/validate'],
  ['POST', '/api/v1/participants/:eventId/join'],
  ['POST', '/api/v1/participants/:participantId/leave'],
  ['POST', '/api/v1/participants/:participantId/password'],
  ['PATCH', '/api/v1/participants/:participantId/profile'],
  ['GET', '/api/v1/participants/:participantId'],
  ['GET', '/api/v1/participants/:eventId/list'],
  ['PUT', '/api/v1/participants/:participantId/premium'],
  ['POST', '/api/v1/participants/:participantId/cooldown'],
  ['POST', '/api/v1/participants/:participantId/kick'],
  ['POST', '/api/v1/participants/:participantId/ban'],
  ['POST', '/api/v1/attendee-session/events/:eventId/join'],
  ['POST', '/api/v1/songs/:eventId/suggest'],
  ['GET', '/api/v1/songs/:eventId/queue'],
  ['GET', '/api/v1/songs/:eventId/pending'],
  ['POST', '/api/v1/songs/:eventId/:songId/approve'],
  ['POST', '/api/v1/songs/:eventId/:songId/reject'],
  ['POST', '/api/v1/songs/:eventId/:songId/skip'],
  ['POST', '/api/v1/songs/:eventId/:songId/send-now'],
  ['GET', '/api/v1/songs/:songId/position'],
  ['POST', '/api/v1/votes'],
  ['DELETE', '/api/v1/votes/:songId/:participantId'],
  ['GET', '/api/v1/votes/:eventId/stats'],
  ['GET', '/api/v1/votes/:songId/:participantId'],
];

const WS_CLIENT_COMMANDS = [
  'join_event',
  'leave_event',
  'suggest_song',
  'approve_song',
  'reject_song',
  'skip_song',
  'send_now',
  'cast_vote',
  'remove_vote',
  'set_cooldown',
  'kick_participant',
  'ban_participant',
  'set_premium',
  'audio_match_start',
  'audio_match_chunk',
  'audio_match_stop',
];

const WS_SERVER_BROADCASTS = [
  'participant_joined',
  'participant_left',
  'participant_disconnected',
  'participant_cooldown',
  'participant_kicked',
  'participant_banned',
  'participant_premium_updated',
  'song_suggested',
  'song_approved',
  'song_rejected',
  'song_skipped',
  'song_now_playing',
  'queue_updated',
  'votes_updated',
  'vote_removed',
  'audio_match_update',
];

function routeFileFor(apiPath) {
  const match = Object.keys(ROUTE_FILES)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => apiPath.startsWith(prefix));
  return ROUTE_FILES[match];
}

function routeLiteral(apiPath) {
  const prefix = Object.keys(ROUTE_FILES)
    .sort((a, b) => b.length - a.length)
    .find((item) => apiPath.startsWith(item));
  const routePath = apiPath.slice(prefix.length) || '/';
  return routePath === '' ? '/' : routePath;
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

function readAll(relativePaths) {
  return relativePaths.map(read).join('\n');
}

describe('frontend/backend route inventory', () => {
  test.each(ROUTES_USED_BY_FRONTEND)('%s %s is mounted by backend routes', (method, apiPath) => {
    const source = read(routeFileFor(apiPath));
    expect(source).toContain(`router.${method.toLowerCase()}(`);
    expect(source).toContain(`'${routeLiteral(apiPath)}'`);
  });

  test.each(WS_CLIENT_COMMANDS)('socket command %s is accepted by backend handlers', (eventName) => {
    const source = read('../../src/socket/handlers.js');
    expect(source).toContain(`'${eventName}'`);
  });

  test.each(WS_SERVER_BROADCASTS)('socket broadcast %s is emitted by backend events', (eventName) => {
    const source = readAll([
      '../../src/socket/audio.js',
      '../../src/socket/participant.js',
      '../../src/socket/room.js',
      '../../src/socket/song.js',
      '../../src/socket/vote.js',
    ]);
    expect(source).toContain(`'${eventName}'`);
  });
});
