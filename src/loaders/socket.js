const http = require('http');
const socketIO = require('socket.io');
const config = require('../config');
const { initializeSocket } = require('../socket');
const { participantsController } = require('../controllers');
const { logger } = require('../utils');

let io = null;
let httpServer = null;

const initSocketIO = (app) => {
  try {
    // Create HTTP server from Express app
    httpServer = http.createServer(app);

    // Initialize Socket.IO
    io = socketIO(httpServer, {
      cors: {
        origin: config.allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Authorization'],
      },
    });

    logger.info('Socket.IO initialized');

    // Inject Socket.IO into controllers that need it
    participantsController.setIO(io);

    // Handle socket connections
    io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);
      initializeSocket(socket, io);

      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });

    // Return both the io instance and the http server
    return { io, httpServer };
  } catch (error) {
    logger.error('Error initializing Socket.IO:', error);
    throw error;
  }
};

const getIO = () => io;
const getHTTPServer = () => httpServer;

module.exports = {
  initSocketIO,
  getIO,
  getHTTPServer,
};
