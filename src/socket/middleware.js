const { authService } = require('../services');
const { logger } = require('../utils');

const socketAuthMiddleware = async (socket, next) => {
  try {
    const authorization = socket.handshake.headers?.authorization || '';
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (authorization.startsWith('Bearer ') ? authorization.slice(7) : null);

    if (!token) {
      return next(new Error('UNAUTHORIZED: missing token'));
    }

    const { decoded, user } = await authService.validateDefaultToken(token);
    socket.user = {
      ...decoded,
      userId: decoded.userId?.toString(),
      id: decoded.userId?.toString(),
      role: user.role,
    };
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
