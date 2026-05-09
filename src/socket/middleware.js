const { verifyToken } = require('../utils/jwt.utils');
const { logger } = require('../utils');

const socketAuthMiddleware = (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('UNAUTHORIZED: missing token'));
    }

    const decoded = verifyToken(token);
    socket.user = decoded;
    socket.token = token;
    next();
  } catch (err) {
    logger.error('Socket auth failed:', err.message);
    next(new Error('UNAUTHORIZED: invalid token'));
  }
};

const requireFields = (data, fields) => {
  if (!data || typeof data !== 'object') return 'payload must be object';
  for (const f of fields) {
    if (data[f] === undefined || data[f] === null || data[f] === '') {
      return `missing field: ${f}`;
    }
  }
  return null;
};

module.exports = { socketAuthMiddleware, requireFields };
