const { authService } = require('../services');
const { logger } = require('../utils');
const { verifyToken } = require('../utils/jwt.utils');

const VALID_ROLES = new Set(['DJ', 'ATTENDEE']);

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

    let decoded;
    let role;
    try {
      const result = await authService.validateDefaultToken(token);
      decoded = result.decoded;
      role = result.user.role;
    } catch (error) {
      decoded = verifyToken(token);
      if (decoded.type !== 'phone-microphone') throw error;
      logger.warn('Auth fallback triggered for phone token', { userId: decoded.userId });
      role = 'DJ';
    }

    if (!VALID_ROLES.has(role)) {
      logger.error('CRITICAL: Socket auth found user with invalid role after DB lookup. User must have role: \'DJ\' or \'ATTENDEE\'. Got:', {
        userId: decoded.userId,
        role,
      });
      return next(new Error('UNAUTHORIZED: invalid role in token'));
    }

    socket.user = {
      ...decoded,
      userId: decoded.userId?.toString(),
      id: decoded.userId?.toString(),
      role,
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
