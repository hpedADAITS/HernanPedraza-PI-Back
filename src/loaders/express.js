const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('../config');
const routes = require('../routes');
const { errorMiddleware, loggerMiddleware } = require('../middleware');
const { initSwagger } = require('./swagger');

const app = express();

// Middleware de seguridad
app.use(helmet());
app.use(
  cors({
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Parseo de cuerpo
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Registro de solicitudes
app.use(loggerMiddleware);

// Swagger API docs
initSwagger(app);

// Rutas de API
app.use('/api/v1', routes);

// Health check endpoints
app.get('/', (req, res) => {
  res.json({ status: 'ok', environment: config.env });
});

app.head('/', (req, res) => {
  res.status(200).end();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', environment: config.env });
});

app.head('/health', (req, res) => {
  res.status(200).end();
});

// Manejador 404
app.use((req, res) =>
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint no encontrado',
    },
  }),
);

// Middleware de manejo de errores (debe ser el último)
app.use(errorMiddleware);

module.exports = app;
