/**
 * Validation Error Class
 * Used for input validation failures
 */
const ApiError = require('./ApiError');
const { httpStatus } = require('../constants');

class ValidationError extends ApiError {
  constructor(message, errors = null) {
    super(message, httpStatus.BAD_REQUEST, errors);
  }
}

module.exports = ValidationError;
