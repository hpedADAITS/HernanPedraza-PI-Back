const { ValidationError } = require('../errors');
const { messages } = require('../constants');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class AuthSchema {
  validateEmail(email) {
    if (!email || typeof email !== 'string') {
      throw new ValidationError(messages.VALIDATION.EMAIL_REQUIRED);
    }
    if (!EMAIL_REGEX.test(email)) {
      throw new ValidationError(messages.VALIDATION.INVALID_EMAIL);
    }
  }

  validatePassword(password) {
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

  validateDisplayName(displayName) {
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

  /* Public register accepts ATTENDEE or DJ only. ADMIN (and anything else)
     is reserved for out-of-band provisioning and is rejected here so it
     never reaches the service layer. */
  validateRegistration({ email, password, displayName, role }) {
    this.validateEmail(email);
    this.validatePassword(password);
    this.validateDisplayName(displayName);
    if (role && !['ATTENDEE', 'DJ'].includes(role)) {
      throw new ValidationError(messages.VALIDATION.INVALID_ROLE);
    }
  }

  validateLogin({ email, password }) {
    if (!email) {
      throw new ValidationError(messages.VALIDATION.EMAIL_REQUIRED);
    }
    if (!password) {
      throw new ValidationError(messages.VALIDATION.PASSWORD_REQUIRED);
    }
    this.validateEmail(email);
    if (typeof password !== 'string' || password.length === 0) {
      throw new ValidationError(messages.VALIDATION.INVALID_PASSWORD);
    }
  }
}

module.exports = new AuthSchema();
