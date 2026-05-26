const { ValidationError } = require('../errors');

/**
 * Song state machine definition
 * Defines valid transitions and roles that can trigger them
 */
const SONG_STATES = {
  PENDING: {
    canTransitionTo: ['APPROVED', 'REJECTED'],
    roles: ['DJ'], // Only DJ can approve/reject
  },
  APPROVED: {
    canTransitionTo: ['PLAYING', 'REJECTED'],
    roles: ['DJ'],
  },
  PLAYING: {
    canTransitionTo: ['PLAYED', 'SKIPPED'],
    roles: ['DJ'],
  },
  PLAYED: {
    canTransitionTo: [],
    roles: [],
  },
  REJECTED: {
    canTransitionTo: [],
    roles: [],
  },
  SKIPPED: {
    canTransitionTo: [],
    roles: [],
  },
};

/**
 * Validates if a state transition is allowed
 * @param {string} currentStatus - Current song status
 * @param {string} newStatus - Desired new status
 * @param {string} userRole - User's role (e.g., 'DJ')
 * @throws {ValidationError} If transition is not allowed
 */
function validateTransition(currentStatus, newStatus, userRole = 'DJ') {
  if (!SONG_STATES[currentStatus]) {
    throw new ValidationError(`Invalid current status: ${currentStatus}`);
  }

  if (!SONG_STATES[newStatus]) {
    throw new ValidationError(`Invalid new status: ${newStatus}`);
  }

  const state = SONG_STATES[currentStatus];

  if (!state.canTransitionTo.includes(newStatus)) {
    const isTerminal = state.canTransitionTo.length === 0;
    throw new ValidationError(
      isTerminal
        ? `Cannot transition from terminal state ${currentStatus} to ${newStatus}`
        : `Cannot transition from ${currentStatus} to ${newStatus}`
    );
  }

  if (state.roles.length > 0 && !state.roles.includes(userRole)) {
    throw new ValidationError(
      `Role '${userRole}' cannot perform this action from state '${currentStatus}'`
    );
  }
}

/**
 * Gets all valid next states from current state
 * @param {string} currentStatus - Current song status
 * @returns {array} Array of valid next statuses
 */
function getValidNextStates(currentStatus) {
  if (!SONG_STATES[currentStatus]) {
    return [];
  }
  return SONG_STATES[currentStatus].canTransitionTo;
}

/**
 * Checks if status is a terminal state (no further transitions)
 * @param {string} status - Song status
 * @returns {boolean}
 */
function isTerminalState(status) {
  if (!SONG_STATES[status]) {
    return false;
  }
  return SONG_STATES[status].canTransitionTo.length === 0;
}

module.exports = {
  SONG_STATES,
  validateTransition,
  getValidNextStates,
  isTerminalState,
};
