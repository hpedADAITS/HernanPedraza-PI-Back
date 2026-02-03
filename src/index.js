const { logger } = require("./utils");
const app = require("./app");
const config = require("./config");
const { initLoaders } = require("./loaders");
const { initSocketIO } = require("./loaders/socket");

const { port } = config;

// Inicializar loaders (base de datos, socket.io, etc)
initLoaders()
  .then(() => {
    // Initialize Socket.IO with Express app
    const { httpServer } = initSocketIO(app);

    // Listen on HTTP server (which wraps Express)
    httpServer.listen(port, (err) => {
      if (err) {
        logger.error(err);
        process.exit(1);
      }
      logger.info(`API de SyncRekuest escuchando en puerto ${port}!`);
      logger.info(`Entorno: ${config.env}`);
    });
  })
  .catch((err) => {
    logger.error("Error al inicializar la aplicación:", err);
    process.exit(1);
  });

process.on("SIGTERM", () => {
  logger.info("Señal SIGTERM recibida: cerrando servidor HTTP");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Señal SIGINT recibida: cerrando servidor HTTP");
  process.exit(0);
});
