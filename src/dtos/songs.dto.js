function toSuggestSongDTO(body) {
  return {
    participantId: body.participantId,
    title: typeof body.title === 'string' ? body.title.trim() : body.title,
    artist: typeof body.artist === 'string' ? body.artist.trim() : body.artist,
  };
}

module.exports = { toSuggestSongDTO };
