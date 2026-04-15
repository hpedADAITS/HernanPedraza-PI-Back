/**
 * Forbidden Error Class
 * Used when user is authenticated but lacks permission for the action
 */
const ApiError = require('./ApiError');
const { httpStatus } = require('../constants');

class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(httpStatus.FORBIDDEN, message);
  }
}

module.exports = ForbiddenError;
