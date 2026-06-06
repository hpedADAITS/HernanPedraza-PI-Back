const { ValidationError } = require('../errors');

function validateCreateEvent(data) {
  const { name, startsAt } = data;
  if (!name || typeof name !== 'string') {
    throw new ValidationError('Event name is required');
  }
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new ValidationError('Event name must be at least 2 characters');
  }
  if (trimmed.length > 100) {
    throw new ValidationError('Event name must be less than 100 characters');
  }
  if (!startsAt) {
    throw new ValidationError('Start date is required');
  }
  const date = new Date(startsAt);
  if (isNaN(date.getTime())) {
    throw new ValidationError('Invalid start date');
  }
}

function validateUpdateEvent(data) {
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      throw new ValidationError('Event name must be a string');
    }
    const trimmed = data.name.trim();
    if (trimmed.length < 2) {
      throw new ValidationError('Event name must be at least 2 characters');
    }
    if (trimmed.length > 100) {
      throw new ValidationError('Event name must be less than 100 characters');
    }
  }
  if (data.description !== undefined && typeof data.description !== 'string') {
    throw new ValidationError('Description must be a string');
  }
  if (data.settings !== undefined && typeof data.settings !== 'object') {
    throw new ValidationError('Settings must be an object');
  }
}

function validateAccessCode(accessCode) {
  if (!accessCode || typeof accessCode !== 'string') {
    throw new ValidationError('Access code is required');
  }
  const trimmed = accessCode.trim();
  if (trimmed.length < 4 || trimmed.length > 20) {
    throw new ValidationError('Access code must be 4-20 characters');
  }
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) {
    throw new ValidationError('Access code must be alphanumeric');
  }
}

module.exports = {
  validateCreateEvent,
  validateUpdateEvent,
  validateAccessCode,
};
