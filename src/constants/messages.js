module.exports = {
  AUTH: {
    INVALID_CREDENTIALS: 'Invalid email or password',
    USER_NOT_FOUND: 'User not found',
    USER_ALREADY_EXISTS: 'User with this email already exists',
    INVALID_TOKEN: 'Invalid or expired token',
    UNAUTHORIZED: 'Unauthorized access',
    PASSWORD_RESET_SENT: 'Password reset email sent',
  },

  EVENT: {
    NOT_FOUND: 'Event not found',
    ACCESS_CODE_INVALID: 'Invalid event access code',
    EVENT_NOT_LIVE: 'Event is not currently live',
    EVENT_ALREADY_STARTED: 'Event has already started',
    PERMISSION_DENIED: 'You do not have permission to perform this action',
  },

  PARTICIPANT: {
    NOT_FOUND: 'Participant not found',
    ALREADY_JOINED: 'You have already joined this event',
    KICKED: 'You have been kicked from this event',
    BANNED: 'You are banned from this event',
    NICKNAME_TAKEN: 'This nickname is already taken in this event',
  },

  SONG: {
    NOT_FOUND: 'Song not found',
    ALREADY_REQUESTED: 'You have already requested this song',
    REQUEST_LIMIT_EXCEEDED:
      'You have reached the maximum number of song requests',
    INVALID_STATUS: 'Invalid song status',
  },

  VOTE: {
    ALREADY_VOTED: 'You have already voted on this song',
    INVALID_VOTE_VALUE: 'Vote must be -1 or 1',
  },

  VALIDATION: {
    REQUIRED_FIELD: 'This field is required',
    INVALID_EMAIL: 'Invalid email format',
    PASSWORD_TOO_SHORT: 'Password must be at least 8 characters',
    INVALID_ACCESS_CODE: 'Access code must be alphanumeric',
  },

  SUCCESS: 'Operation completed successfully',
  CREATED: 'Resource created successfully',
  UPDATED: 'Resource updated successfully',
  DELETED: 'Resource deleted successfully',
  INTERNAL_ERROR: 'An unexpected error occurred',
  SERVER_ERROR: 'Internal server error',
};
