require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const DEVELOPMENT_JWT_SECRET = 'syncrekuest-local-development-secret';
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;
const debugMode = process.env.DEBUG_MODE === 'true';

if (env === 'production' && debugMode) {
  throw new Error('DEBUG_MODE cannot be enabled in production');
}

function readJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (env !== 'production') {
    return secret || DEVELOPMENT_JWT_SECRET;
  }

  if (!secret) {
    throw new Error('JWT_SECRET is required in production');
  }

  if (secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`,
    );
  }

  return secret;
}

module.exports = {
  /* Servidor */
  port: process.env.PORT || 5000,
  env,
  debugMode,

  /* DB */
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/syncrekuest',
  dbName: process.env.DB_NAME || 'syncrekuest',

  /* JWT */
  jwtSecret: readJwtSecret(),
  jwtExpiry: process.env.JWT_EXPIRES_IN || '24h',

  /* CORS */
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS || 'http://localhost:5173'
  ).split(','),

  /* Socket.IO */
  socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:5173',

  /* Logger */
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || 'logs/app.log',
};
