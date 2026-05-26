const { ValidationError } = require('../errors');

class SongsSchema {
  parseSuggestSong(body) {
    // Transform
    const data = {
      participantId: body.participantId,
      title: typeof body.title === 'string' ? body.title.trim() : body.title,
      artist: typeof body.artist === 'string' ? body.artist.trim() : body.artist,
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

    return data;
  }
}

module.exports = new SongsSchema();
