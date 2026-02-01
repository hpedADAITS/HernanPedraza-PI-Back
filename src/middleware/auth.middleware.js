const { verifyToken } = require("../utils/jwt.utils");
const { logger } = require("../utils");

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "No se proporcionó token de autorización",
        },
      });
    }

    const [bearer, token] = authHeader.split(" ");

    if (bearer !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        error: {
          code: "INVALID_TOKEN_FORMAT",
          message: "Formato de token inválido. Usa: Bearer <token>",
        },
      });
    }

    const decoded = verifyToken(token);
    req.user = decoded;
    req.token = token;

    next();
  } catch (error) {
    logger.error("Error de autenticación:", error.message);
    res.status(401).json({
      success: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Token inválido o expirado",
      },
    });
  }
};

module.exports = authMiddleware;
