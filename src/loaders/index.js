const mongoLoader = require("./database");
const { logger } = require("../utils");

const initLoaders = async () => {
  try {
    logger.info("Inicializando cargadores...");

    logger.info("Conectando a MongoDB...");
    await mongoLoader();

    logger.info("Todos los cargadores inicializados exitosamente");
  } catch (error) {
    logger.error("Error al inicializar cargadores:", error);
    throw error;
  }
};

module.exports = { initLoaders };
