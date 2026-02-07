/**
 * Base API Error Class
 * All API errors should extend this class for consistent error handling
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.message = message;
    this.details = details;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = this.constructor.name;
  }

  toJSON() {
    return {
      error: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

module.exports = ApiError;
