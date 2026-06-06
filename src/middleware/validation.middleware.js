const { logger } = require('../utils');

/**
 * Factoría de middleware de validación
 * @param {Object} schema - Esquema de validación (ej. esquema Joi)
 * @returns {Function} Middleware de Express
 */
const validationMiddleware = (schema) => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(
        {
          body: req.body,
          params: req.params,
          query: req.query,
        },
        {
          abortEarly: false,
          stripUnknown: true,
        },
      );

      if (error) {
        const messages = error.details.map((d) => d.message).join(', ');
        logger.warn(`Error de validación: ${messages}`);
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validación fallida',
            details: error.details,
          },
        });
      }

      /* Reemplazar datos de solicitud con datos validados */
      req.body = value.body;
      req.params = value.params;
      req.query = value.query;

      next();
    } catch (err) {
      logger.error('Error del middleware de validación:', err);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error interno de validación',
        },
      });
    }
  };
};

module.exports = validationMiddleware;
