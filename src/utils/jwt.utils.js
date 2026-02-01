const jwt = require("jsonwebtoken");
const config = require("../config");
const { logger } = require("./logger");

const generateToken = (userId, expiresIn = config.jwtExpiry) => {
  try {
    const token = jwt.sign({ userId }, config.jwtSecret, {
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
