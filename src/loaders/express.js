const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const routes = require('../routes');
const { errorMiddleware, loggerMiddleware } = require('../middleware');
const { initSwagger } = require('./swagger');

const app = express();

/* Security middleware */
app.use(helmet());
app.use(
  cors({
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

/* Rate limiting */
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
}));

/* Body parsing */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Request logging */
app.use(loggerMiddleware);

/* Swagger API docs */
initSwagger(app);

/* Rutas de API */
app.use('/api/v1', routes);

/* Health check endpoints */
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

/* 404 handler */
app.use((req, res) =>
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  }),
);

/* Error handling middleware (must be last) */
app.use(errorMiddleware);

module.exports = app;
