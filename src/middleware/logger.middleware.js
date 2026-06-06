const { logger } = require('../utils');

const loggerMiddleware = (req, res, next) => {
  const start = Date.now();

  /* Log response when it finishes */
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'error' : 'info';

    logger[logLevel](
      `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        ip: req.ip,
      },
    );
  });

  next();
};

module.exports = loggerMiddleware;
