const { authService } = require('../services');
const { logger } = require('../utils');

const VALID_ROLES = new Set(['DJ', 'ATTENDEE']);

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'No se proporcionó token de autorización',
        },
      });
    }

    const [bearer, token] = authHeader.split(' ');

    if (bearer !== 'Bearer' || !token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN_FORMAT',
          message: 'Formato de token inválido. Usa: Bearer <token>',
        },
      });
    }

    const { decoded, user } = await authService.validateDefaultToken(token);

    const role = user.role;
    if (!VALID_ROLES.has(role)) {
      logger.error('CRITICAL: Auth middleware found user with invalid role after DB lookup. User must have role: \'DJ\' or \'ATTENDEE\'. Got:', {
        userId: decoded.userId,
        role,
      });
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_ROLE',
          message: 'Token contains invalid role after verification',
        },
      });
    }

    req.user = {
      ...decoded,
      role,
    };
    req.token = token;

    next();
  } catch (error) {
    logger.error('Error de autenticación:', error.message);
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Token inválido o expirado',
      },
    });
  }
};

module.exports = authMiddleware;
