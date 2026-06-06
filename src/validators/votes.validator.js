const { ValidationError } = require('../errors');

function validateCastVote(data) {
  const { songId, participantId, value } = data;
  if (!songId) {
    throw new ValidationError('Song ID is required');
  }
  if (!participantId) {
    throw new ValidationError('Participant ID is required');
  }
  if (value === undefined || value === null) {
    throw new ValidationError('Vote value is required');
  }
  if (![1, -1].includes(value)) {
    throw new ValidationError('Vote must be 1 or -1');
  }
}

module.exports = { validateCastVote };
