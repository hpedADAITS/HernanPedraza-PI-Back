const jwt = require("jsonwebtoken");
const config = require("../config");
const { logger } = require("./logger");

const generateToken = (userPayload, expiresIn = config.jwtExpiry) => {
  try {
    // Handle both string userId and user object with metadata
    let payload;
    if (typeof userPayload === 'string') {
      payload = { userId: userPayload };
    } else if (typeof userPayload === 'object' && userPayload.userId) {
      // Ensure userId is a string
      payload = {
        userId: typeof userPayload.userId === 'string' 
          ? userPayload.userId 
          : userPayload.userId.toString(),
        ...(userPayload.email && { email: userPayload.email }),
        ...(userPayload.role && { role: userPayload.role }),
      };
    } else {
      throw new Error("Invalid payload for token generation");
    }

    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn,
      algorithm: "HS256",
    });
    return token;
  } catch (error) {
    logger.error("Error al generar token:", error);
    throw error;
  }
};

const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
    });
    return decoded;
  } catch (error) {
    logger.error("Error al verificar token:", error.message);
    throw error;
  }
};

const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    logger.error("Error al decodificar token:", error);
    return null;
  }
};

module.exports = {
  generateToken,
  verifyToken,
  decodeToken,
};
