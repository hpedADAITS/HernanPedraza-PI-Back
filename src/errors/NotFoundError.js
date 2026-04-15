/**
 * Not Found Error Class
 * Used when a requested resource is not found
 */
const ApiError = require('./ApiError');
const { httpStatus } = require('../constants');

class NotFoundError extends ApiError {
  constructor(message = 'Resource not found') {
    super(message, httpStatus.NOT_FOUND);
  }
}

module.exports = NotFoundError;
