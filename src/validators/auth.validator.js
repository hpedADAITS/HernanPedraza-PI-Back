/**
 *  Validacion de credenciales
 *  Valida credenciales de autorizacion y establece criterios de contrase;as
 */

const { ValidationError } = require('../errors');
const { messages } = require('../constants');

/**
 * Valida formato email
 */

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string') {
    throw new ValidationError(messages.VALIDATION.EMAIL_REQUIRED);
  }
  if (!emailRegex.test(email)) {
    throw new ValidationError(messages.VALIDATION.INVALID_EMAIL);
  }
}

/**
 * Valida pass
 */

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw new ValidationError(messages.VALIDATION.PASSWORD_REQUIRED);
  }
  if (password.length < 8) {
    throw new ValidationError(messages.VALIDATION.PASSWORD_TOO_SHORT);
  }
  if (password.length > 128) {
    throw new ValidationError(messages.VALIDATION.PASSWORD_TOO_LONG);
  }
}

/**
 * Valida nombre usuario
 */

function validateDisplayName(displayName) {
  if (!displayName || typeof displayName !== 'string') {
    throw new ValidationError(messages.VALIDATION.DISPLAY_NAME_REQUIRED);
  }
  const trimmed = displayName.trim();
  if (trimmed.length < 2) {
    throw new ValidationError(messages.VALIDATION.DISPLAY_NAME_TOO_SHORT);
  }
  if (trimmed.length > 50) {
    throw new ValidationError(messages.VALIDATION.DISPLAY_NAME_TOO_LONG);
  }
}

/**
 * Valida regisro y Rol
 */

function validateRegistration(data) {
  const { email, password, displayName } = data;

  validateEmail(email);
  validatePassword(password);
  validateDisplayName(displayName);

  /* Public register accepts ATTENDEE or DJ only. ADMIN is reserved for
     out-of-band provisioning (debug service / direct DB) and is rejected
     at the validator so it never reaches the service layer. */
  if (data.role && !['ATTENDEE', 'DJ'].includes(data.role)) {
    throw new ValidationError(messages.VALIDATION.INVALID_ROLE);
  }
}

/**
 * Valida login
 */

function validateLogin(data) {
  const { email, password } = data;

  if (!email) {
    throw new ValidationError(messages.VALIDATION.EMAIL_REQUIRED);
  }
  if (!password) {
    throw new ValidationError(messages.VALIDATION.PASSWORD_REQUIRED);
  }

  validateEmail(email);
  if (typeof password !== 'string' || password.length === 0) {
    throw new ValidationError(messages.VALIDATION.INVALID_PASSWORD);
  }
}

/**
 * Valida token request
 */

function validateTokenRefresh(data) {
  const { token } = data;

  if (!token) {
    throw new ValidationError(messages.VALIDATION.TOKEN_REQUIRED);
  }
  if (typeof token !== 'string') {
    throw new ValidationError(messages.VALIDATION.INVALID_TOKEN);
  }
}

module.exports = {
  validateEmail,
  validatePassword,
  validateDisplayName,
  validateRegistration,
  validateLogin,
  validateTokenRefresh,
};
