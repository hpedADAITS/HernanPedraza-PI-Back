const { ValidationError } = require('../errors');

class ParticipantsSchema {
  parseJoinEvent(body) {
    // Transform
    const data = {
      nickname:
        typeof body.nickname === 'string' ? body.nickname.trim() : body.nickname,
      profilePicture:
        typeof body.profilePicture === 'string' ? body.profilePicture : null,
      password:
        typeof body.password === 'string' ? body.password : undefined,
    };

    // Validate
    if (!data.nickname || typeof data.nickname !== 'string') {
      throw new ValidationError('Nickname is required');
    }
    if (data.nickname.length < 2) {
      throw new ValidationError('Nickname must be at least 2 characters');
    }
    if (data.nickname.length > 30) {
      throw new ValidationError('Nickname must be less than 30 characters');
    }
    if (data.profilePicture !== null && typeof data.profilePicture !== 'string') {
      throw new ValidationError('Profile picture must be a valid string');
    }
    if (data.password !== undefined && data.password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    return data;
  }

  parseSetPassword(body) {
    const data = {
      password: typeof body.password === 'string' ? body.password : body.password,
    };

    if (!data.password || typeof data.password !== 'string') {
      throw new ValidationError('Password is required');
    }
    if (data.password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }
    if (data.password.length > 128) {
      throw new ValidationError('Password must be less than 128 characters');
    }

    return data;
  }

  parseUpdateProfile(body) {
    const data = {
      nickname:
        typeof body.nickname === 'string' ? body.nickname.trim() : undefined,
      profilePicture:
        typeof body.profilePicture === 'string' || body.profilePicture === null
          ? body.profilePicture
          : undefined,
    };

    if (data.nickname === undefined && data.profilePicture === undefined) {
      throw new ValidationError('No participant profile updates provided');
    }
    if (data.nickname !== undefined && data.nickname.length < 2) {
      throw new ValidationError('Nickname must be at least 2 characters');
    }
    if (data.nickname !== undefined && data.nickname.length > 30) {
      throw new ValidationError('Nickname must be less than 30 characters');
    }

    return data;
  }

  parseKickParticipant(body) {
    // Transform
    const data = {
      reason: typeof body.reason === 'string' ? body.reason.trim() : body.reason,
    };

    // Validate
    if (!data.reason || typeof data.reason !== 'string') {
      throw new ValidationError('Kick reason is required');
    }
    if (data.reason.length < 1) {
      throw new ValidationError('Kick reason cannot be empty');
    }
    if (data.reason.length > 200) {
      throw new ValidationError('Kick reason must be less than 200 characters');
    }

    return data;
  }

  parseBanParticipant(body) {
    const data = {
      reason: typeof body.reason === 'string' ? body.reason.trim() : body.reason,
    };

    if (!data.reason || typeof data.reason !== 'string') {
      throw new ValidationError('Ban reason is required');
    }
    if (data.reason.length < 1) {
      throw new ValidationError('Ban reason cannot be empty');
    }
    if (data.reason.length > 200) {
      throw new ValidationError('Ban reason must be less than 200 characters');
    }

    return data;
  }

  parseCooldown(body) {
    // Transform
    const data = {
      durationMs:
        typeof body.durationMs === 'string'
          ? parseInt(body.durationMs, 10)
          : body.durationMs,
      reason: typeof body.reason === 'string' ? body.reason.trim() : body.reason,
    };

    // Validate
    if (!data.durationMs || typeof data.durationMs !== 'number') {
      throw new ValidationError('Cooldown duration is required');
    }
    if (data.durationMs < 1000) {
      throw new ValidationError('Cooldown must be at least 1 second');
    }
    if (data.durationMs > 86400000) {
      throw new ValidationError('Cooldown cannot exceed 24 hours');
    }
    if (!data.reason || typeof data.reason !== 'string') {
      throw new ValidationError('Cooldown reason is required');
    }
    if (data.reason.length < 1) {
      throw new ValidationError('Cooldown reason cannot be empty');
    }

    return data;
  }

  parseSetPremium(body) {
    // Transform & Validate
    if (typeof body.isPremium !== 'boolean') {
      throw new ValidationError('isPremium must be a boolean');
    }

    return { isPremium: body.isPremium };
  }
}

module.exports = new ParticipantsSchema();
