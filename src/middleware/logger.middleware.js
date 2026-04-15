const { logger } = require('../utils');

const loggerMiddleware = (req, res, next) => {
  const start = Date.now();

  // Registrar la respuesta cuando finaliza
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'error' : 'info';

    logger[logLevel](
      `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
      {
        metodo: req.method,
        ruta: req.path,
        codigoEstado: res.statusCode,
        duracion: duration,
        ip: req.ip,
      },
    );
  });

  next();
};

module.exports = loggerMiddleware;
