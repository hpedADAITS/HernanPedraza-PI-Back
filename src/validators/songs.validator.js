const { ValidationError } = require('../errors');

function validateSuggestSong(data) {
  const { participantId, title, artist } = data;
  if (!participantId) {
    throw new ValidationError('Participant ID is required');
  }
  if (!title || typeof title !== 'string') {
    throw new ValidationError('Song title is required');
  }
  if (title.trim().length < 1) {
    throw new ValidationError('Song title cannot be empty');
  }
  if (title.trim().length > 200) {
    throw new ValidationError('Song title must be less than 200 characters');
  }
  if (!artist || typeof artist !== 'string') {
    throw new ValidationError('Artist name is required');
  }
  if (artist.trim().length < 1) {
    throw new ValidationError('Artist name cannot be empty');
  }
  if (artist.trim().length > 200) {
    throw new ValidationError('Artist name must be less than 200 characters');
  }
}

module.exports = { validateSuggestSong };
