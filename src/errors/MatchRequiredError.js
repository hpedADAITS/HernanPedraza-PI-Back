/**
 * Match Required Error
 * Thrown when a song is not eligible to be promoted to Now Playing because
 * it has no audio fingerprint / recognition match bound to it. The client
 * should use this to surface a "waiting for microphone" hint instead of a
 * generic failure.
 */
const ApiError = require('./ApiError');
const { httpStatus } = require('../constants');

class MatchRequiredError extends ApiError {
  constructor(message = 'Song needs a fingerprint match before it can be played', details = null) {
    super(message, httpStatus.CONFLICT, details);
    this.code = 'MATCH_REQUIRED';
  }
}

module.exports = MatchRequiredError;
