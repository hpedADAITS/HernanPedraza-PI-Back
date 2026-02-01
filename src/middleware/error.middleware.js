const { logger } = require("../utils");

const errorMiddleware = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Error Interno del Servidor";
  const code = err.code || "INTERNAL_ERROR";

  logger.error(`[${statusCode}] ${code}: ${message}`, {
    ruta: req.path,
    metodo: req.method,
    stack: err.stack,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
    statusCode,
  });
};

module.exports = errorMiddleware;
