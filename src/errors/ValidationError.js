/**
 * Validation Error Class
 * Used for input validation failures
 */
const ApiError = require("./ApiError");
const { httpStatus } = require("../constants");

class ValidationError extends ApiError {
  constructor(message, errors = null) {
    super(httpStatus.BAD_REQUEST, message, errors);
  }
}

module.exports = ValidationError;
