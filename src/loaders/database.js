const config = require('../config');
const { logger } = require('../utils');

let connection;

const mongoLoader = async () => {
  try {
    /* Importar dinámicamente la conexión de mongoose desde models/schema */
    const { connectMongo } = require('../models/schema');

    logger.info('Conectando a MongoDB...');
    connection = await connectMongo(config.mongoUri, config.dbName);

    logger.info(`MongoDB conectado exitosamente a ${config.dbName}`);
    return connection;
  } catch (error) {
    logger.error('Error de conexión a MongoDB:', error.message);
    throw error;
  }
};

const getConnection = () => {
  if (!connection) {
    throw new Error('Base de datos no conectada. Llama a mongoLoader primero.');
  }
  return connection;
};

module.exports = mongoLoader;
module.exports.getConnection = getConnection;
