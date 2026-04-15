/**
 * Generar un código de acceso aleatorio para eventos
 * Formato: 6-8 caracteres alfanuméricos en mayúscula
 * @returns {string} Código de acceso del evento
 */
const generateEventCode = (length = 6) => {
  if (!Number.isInteger(length) || length < 4 || length > 10) {
    throw new Error('La longitud del código debe estar entre 4 y 10');
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
};

/**
 * Generar un ID único (puede usarse como ID de sesión de socket, etc)
 * @returns {string} ID único
 */
const generateUniqueId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Generar un nonce para operaciones seguras
 * @returns {string} Nonce
 */
const generateNonce = (length = 16) => {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let i = 0; i < length; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
};

module.exports = {
  generateEventCode,
  generateUniqueId,
  generateNonce,
};
