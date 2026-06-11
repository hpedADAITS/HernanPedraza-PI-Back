const ALL_EVENT_PERMISSIONS = [
  'QUEUE_READ',
  'QUEUE_EDIT',
  'SONG_SUGGEST',
  'SONG_VOTE',
  'SONG_APPROVE_REJECT',
  'PARTICIPANT_KICK',
  'PARTICIPANT_BAN',
  'EVENT_START',
  'EVENT_END',
  'EVENT_CANCEL',
  'EVENT_SETTINGS_EDIT',
  'ANALYTICS_READ',
];

function defaultPermissionsForRole(role) {
  switch (role) {
  case 'DJ':
    return [
      'QUEUE_READ',
      'QUEUE_EDIT',
      'SONG_APPROVE_REJECT',
      'PARTICIPANT_KICK',
      'PARTICIPANT_BAN',
      'EVENT_START',
      'EVENT_END',
      'EVENT_CANCEL',
      'EVENT_SETTINGS_EDIT',
    ];
  case 'ATTENDEE':
    return ['QUEUE_READ', 'SONG_SUGGEST', 'SONG_VOTE'];
  default:
    return ['QUEUE_READ'];
  }
}

module.exports = {
  ALL_EVENT_PERMISSIONS,
  defaultPermissionsForRole,
};
