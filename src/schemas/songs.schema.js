const { ValidationError } = require('../errors');

class SongsSchema {
  parseSuggestSong(body) {
    // Transform
    const data = {
      participantId: body.participantId,
      title: typeof body.title === 'string' ? body.title.trim() : body.title,
      artist: typeof body.artist === 'string' ? body.artist.trim() : body.artist,
      totalDuration: body.totalDuration ?? body.duration,
    };

    // Validate
    if (!data.participantId) {
      throw new ValidationError('Participant ID is required');
    }
    if (!data.title || typeof data.title !== 'string') {
      throw new ValidationError('Song title is required');
    }
    if (data.title.length < 1) {
      throw new ValidationError('Song title cannot be empty');
    }
    if (data.title.length > 200) {
      throw new ValidationError('Song title must be less than 200 characters');
    }
    if (!data.artist || typeof data.artist !== 'string') {
      throw new ValidationError('Artist name is required');
    }
    if (data.artist.length < 1) {
      throw new ValidationError('Artist name cannot be empty');
    }
    if (data.artist.length > 200) {
      throw new ValidationError('Artist name must be less than 200 characters');
    }
    if (
      data.totalDuration !== undefined &&
      (!Number.isFinite(Number(data.totalDuration)) || Number(data.totalDuration) < 0)
    ) {
      throw new ValidationError('Song duration must be a positive number');
    }

    return {
      ...data,
      totalDuration:
        data.totalDuration === undefined
          ? undefined
          : Math.floor(Number(data.totalDuration)),
    };
  }
}

module.exports = new SongsSchema();
