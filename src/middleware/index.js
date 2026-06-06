const authMiddleware = require('./auth.middleware');
const errorMiddleware = require('./error.middleware');
const loggerMiddleware = require('./logger.middleware');
const validationMiddleware = require('./validation.middleware');

module.exports = {
  authMiddleware,
  authenticate: authMiddleware, // Alias
  errorMiddleware,
  loggerMiddleware,
  validationMiddleware,
};
