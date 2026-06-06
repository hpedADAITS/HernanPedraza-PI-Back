const http = require('http');
const { Server } = require('socket.io');
const config = require('../config');
const { initializeSocket, socketAuthMiddleware } = require('../socket');
const {
  eventsController,
  participantsController,
  attendeeSessionController,
  songsController,
  votesController,
} = require('../controllers');
const { setIO } = require('../services/realtime.service');
const { logger } = require('../utils');

let io = null;
let httpServer = null;

const initSocketIO = (app) => {
  try {
    httpServer = http.createServer(app);

    io = new Server(httpServer, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      cors: {
        origin: config.allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
      },
    });

    logger.info('Socket.IO initialized', {
      allowedOrigins: config.allowedOrigins,
    });

    const socketAuthDisabled =
      process.env.SOCKET_AUTH_DISABLED === 'true' &&
      process.env.NODE_ENV !== 'production';

    if (!socketAuthDisabled) {
      io.use((socket, next) => {
        logger.info('Socket.IO auth attempt', {
          id: socket.id,
          origin: socket.handshake.headers.origin,
          transport: socket.conn.transport.name,
          hasAuthToken: Boolean(socket.handshake.auth?.token),
          hasQueryToken: Boolean(socket.handshake.query?.token),
        });

        socketAuthMiddleware(socket, (error) => {
          if (error) {
            logger.warn('Socket.IO auth rejected', {
              message: error.message,
              origin: socket.handshake.headers.origin,
              auth: socket.handshake.auth,
              query: socket.handshake.query,
            });
            return next(error);
          }

          next();
        });
      });

      logger.info('Socket.IO auth middleware enabled');
    } else {
      logger.warn('Socket.IO auth middleware DISABLED');
    }

    setIO(io);

    io.on('connection', (socket) => {
      logger.info('Socket connected', {
        id: socket.id,
        origin: socket.handshake.headers.origin,
        transport: socket.conn.transport.name,
      });

      socket.conn.on('upgrade', (transport) => {
        logger.info('Socket upgraded', {
          id: socket.id,
          transport: transport.name,
        });
      });

      initializeSocket(socket, io);

      socket.on('disconnect', (reason) => {
        logger.info('Socket disconnected', {
          id: socket.id,
          reason,
        });
      });
    });

    io.engine.on('connection_error', (error) => {
      logger.warn('Socket.IO connection error', {
        code: error.code,
        message: error.message,
        context: error.context,
        requestUrl: error.req?.url,
        origin: error.req?.headers?.origin,
      });
    });

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