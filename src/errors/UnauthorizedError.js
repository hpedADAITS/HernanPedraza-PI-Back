/**
 * Unauthorized Error Class
 * Used when authentication fails or user lacks permissions
 */
const ApiError = require('./ApiError');
const { httpStatus } = require('../constants');

class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized access') {
    super(message, httpStatus.UNAUTHORIZED);
  }
}

module.exports = UnauthorizedError;
