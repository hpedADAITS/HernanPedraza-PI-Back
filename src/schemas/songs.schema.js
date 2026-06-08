const { ValidationError } = require('../errors');
const { isValidSongText } = require('./validation-rules');

class SongsSchema {
  parseSuggestSong(body) {
    // Transform
    const data = {
      participantId: body.participantId,
      title: typeof body.title === 'string' ? body.title.trim() : body.title,
      artist: typeof body.artist === 'string' ? body.artist.trim() : body.artist,
      totalDuration: body.totalDuration ?? body.duration,
      musicBrainzConfirmed: body.musicBrainzConfirmed === true,
      skipMusicBrainzLookup: body.skipMusicBrainzLookup === true,
      musicBrainzMatch: normalizeMusicBrainzMatch(body.musicBrainzMatch),
      fingerprintTrackId: cleanObjectId(body.fingerprintTrackId),
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
    if (!isValidSongText(data.title)) {
      throw new ValidationError('Song title contains invalid characters');
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
    if (!isValidSongText(data.artist)) {
      throw new ValidationError('Artist name contains invalid characters');
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
      musicBrainzConfirmed: data.musicBrainzConfirmed,
      skipMusicBrainzLookup: data.skipMusicBrainzLookup,
      musicBrainzMatch: data.musicBrainzMatch,
      fingerprintTrackId: data.fingerprintTrackId,
    };
  }

  parseSearchFingerprints(body) {
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body is required');
    }
    if (!body.participantId) {
      throw new ValidationError('Participant ID is required');
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
    if (title.length > 200 || artist.length > 200) {
      throw new ValidationError('Search query is too long');
    }
    if (title && !isValidSongText(title)) {
      throw new ValidationError('Title contains invalid characters');
    }
    if (artist && !isValidSongText(artist)) {
      throw new ValidationError('Artist contains invalid characters');
    }
    return { participantId: body.participantId, title, artist };
  }
}

function normalizeMusicBrainzMatch(match) {
  if (!match || typeof match !== 'object') return null;
  const score = Number(match.score);
  return {
    source: 'musicbrainz',
    recordingId: cleanString(match.recordingId),
    releaseId: cleanString(match.releaseId),
    title: cleanString(match.title),
    artist: cleanString(match.artist),
    coverUrl: cleanString(match.coverUrl),
    duration: Number.isFinite(Number(match.duration)) && Number(match.duration) >= 0
      ? Math.floor(Number(match.duration))
      : null,
    score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : null,
    matchedOn: ['title', 'artist', 'title_artist'].includes(match.matchedOn)
      ? match.matchedOn
      : 'title_artist',
  };
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanObjectId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9a-fA-F]{24}$/.test(trimmed)) {
    throw new ValidationError('Fingerprint track ID is invalid');
  }
  return trimmed;
}

module.exports = new SongsSchema();
