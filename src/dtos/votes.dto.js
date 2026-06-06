function toCastVoteDTO(body) {
  return {
    songId: body.songId,
    participantId: body.participantId,
    value:
      typeof body.value === 'string' ? parseInt(body.value, 10) : body.value,
  };
}

module.exports = { toCastVoteDTO };
