require('dotenv').config();

module.exports = {
  // Servidor
  port: process.env.PORT || 5000,
  env: process.env.NODE_ENV || 'development',

  // DB
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/syncrekuest',
  dbName: process.env.DB_NAME || 'syncrekuest',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'tu-clave-secreta-cambiar-en-produccion',
  jwtExpiry: process.env.JWT_EXPIRES_IN || '24h',

  // CORS
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000'
  ).split(','),

  // Socket.IO
  socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:5173',

  // Logger
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || 'logs/app.log',
};
