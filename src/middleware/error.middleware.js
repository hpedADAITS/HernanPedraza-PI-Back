const { logger } = require('../utils');
const { httpStatus } = require('../constants');
const { ApiError } = require('../errors');

const errorMiddleware = (err, req, res, next) => {
  let statusCode = httpStatus.INTERNAL_SERVER_ERROR;
  let message = 'Internal server error';
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let details = null;

  /* Handle custom ApiError instances */
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    errorCode = err.code || err.name;
    details = err.details;
  } else if (err.statusCode && err.message) {
    /* Handle errors with statusCode property */
    statusCode = err.statusCode;
    message = err.message;
    errorCode = err.code || 'ERROR';
  } else if (err instanceof Error) {
    /* Handle generic JavaScript errors */
    message = err.message || 'An unexpected error occurred';
    errorCode = 'ERROR';
  }

  /* Log error with context */
  logger.error(`[${statusCode}] ${errorCode}: ${message}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.userId || 'anonymous',
    stack: err.stack,
    details,
  });

  /* Send error response */
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      ...(details && { details }),
    },
    statusCode,
    timestamp: new Date().toISOString(),
  });
};

module.exports = errorMiddleware;
