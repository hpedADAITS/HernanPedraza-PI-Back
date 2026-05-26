const { ValidationError } = require('../errors');

class VotesSchema {
  parseCastVote(body) {
    // Transform
    const data = {
      songId: body.songId,
      participantId: body.participantId,
      value:
        typeof body.value === 'string' ? parseInt(body.value, 10) : body.value,
    };

    // Validate
    if (!data.songId) {
      throw new ValidationError('Song ID is required');
    }
    if (!data.participantId) {
      throw new ValidationError('Participant ID is required');
    }
    if (data.value === undefined || data.value === null) {
      throw new ValidationError('Vote value is required');
    }
    if (![1, -1].includes(data.value)) {
      throw new ValidationError('Vote must be 1 or -1');
    }

    return data;
  }
}

module.exports = new VotesSchema();
