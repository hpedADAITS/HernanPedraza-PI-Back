const { ValidationError } = require('../errors');

class EventsSchema {
  parseCreateEvent(body) {
    // Transform
    const data = {
      name: typeof body.name === 'string' ? body.name.trim() : body.name,
      description:
        typeof body.description === 'string'
          ? body.description.trim()
          : body.description || '',
      startsAt: body.startsAt,
    };

    // Validate
    if (!data.name || typeof data.name !== 'string') {
      throw new ValidationError('Event name is required');
    }
    if (data.name.length < 2) {
      throw new ValidationError('Event name must be at least 2 characters');
    }
    if (data.name.length > 100) {
      throw new ValidationError('Event name must be less than 100 characters');
    }
    if (!data.startsAt) {
      throw new ValidationError('Start date is required');
    }
    const date = new Date(data.startsAt);
    if (isNaN(date.getTime())) {
      throw new ValidationError('Invalid start date');
    }

    return data;
  }

  parseUpdateEvent(body) {
    // Transform
    const data = {};
    if (body.name !== undefined)
      data.name = typeof body.name === 'string' ? body.name.trim() : body.name;
    if (body.description !== undefined)
      data.description =
        typeof body.description === 'string'
          ? body.description.trim()
          : body.description;
    if (body.settings !== undefined) data.settings = body.settings;

    // Validate
    if (data.name !== undefined) {
      if (typeof data.name !== 'string') {
        throw new ValidationError('Event name must be a string');
      }
      if (data.name.length < 2) {
        throw new ValidationError('Event name must be at least 2 characters');
      }
      if (data.name.length > 100) {
        throw new ValidationError('Event name must be less than 100 characters');
      }
    }
    if (
      data.description !== undefined &&
      typeof data.description !== 'string'
    ) {
      throw new ValidationError('Description must be a string');
    }
    if (data.settings !== undefined && typeof data.settings !== 'object') {
      throw new ValidationError('Settings must be an object');
    }

    return data;
  }

  parseAccessCode(accessCode) {
    // Transform & Validate
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
    return trimmed;
  }
}

module.exports = new EventsSchema();
