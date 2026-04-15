/**
 *  Validacion de credenciales
 *  Valida credenciales de autorizacion y establece criterios de contrase;as
 */

const { ValidationError } = require('../errors');

/**
 * Valida formato email
 */

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string') {
    throw new ValidationError('Email required');
  }
  if (!emailRegex.test(email)) {
    throw new ValidationError('Invalid mail format');
  }
}

/**
 * Valida pass
 */

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw new ValidationError('Password required');
  }
  if (password.length < 8) {
    throw new ValidationError('Password must be AT LEAST 8 characters long');
  }
  if (password.length > 128) {
    throw new ValidationError('Password too long');
  }
}

/**
 * Valida nombre usuario
 */

function validateDisplayName(displayName) {
  if (!displayName || typeof displayName !== 'string') {
    throw new ValidationError('Display name required');
  }
  const trimmed = displayName.trim();
  if (trimmed.length < 2) {
    throw new ValidationError('Display name must be at least 2 characters');
  }
  if (trimmed.length > 50) {
    throw new ValidationError('Display name must be less than 50 characters');
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

  // Validate role if provided
  if (data.role && !['ATTENDEE', 'DJ', 'ADMIN'].includes(data.role)) {
    throw new ValidationError(
      'Invalid role. It must be either ATTENDEE, DJ, or ADMIN',
    );
  }
}

/**
 * Valida login
 */

function validateLogin(data) {
  const { email, password } = data;

  if (!email) {
    throw new ValidationError('Email is required');
  }
  if (!password) {
    throw new ValidationError('Password is required');
  }

  validateEmail(email);
  if (typeof password !== 'string' || password.length === 0) {
    throw new ValidationError('Invalid password');
  }
}

/**
 * Valida token request
 */

function validateTokenRefresh(data) {
  const { token } = data;

  if (!token) {
    throw new ValidationError('Token is required');
  }
  if (typeof token !== 'string') {
    throw new ValidationError('Invalid token format');
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
