const {
  SongModel,
  EventModel,
  AudioTrackModel,
  ParticipantModel,
} = require('../models/schema');
const crypto = require('crypto');
const { logger } = require('../utils');
const { ForbiddenError, NotFoundError, ValidationError, MatchRequiredError } = require('../errors');
const { validateTransition } = require('../utils/song-state-machine');
const participantsService = require('./participants.service');
const eventPermissionsService = require('./event-permissions.service');
const musicBrainzService = require('./musicbrainz.service');
const { decryptCoverUrl, encryptCoverUrl } = require('./cover-url-crypto');

const MUSICBRAINZ_LOOKUP_THROTTLE_MS = 1550;
const COVER_DOWNLOAD_TIMEOUT_MS = 8000;
const MAX_COVER_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const musicBrainzLookupThrottle = new Map();

class SongsService {
  async suggestSong(eventId, participantId, title, artist, totalDuration, actorUser, options = {}) {
    await participantsService.assertParticipantSession(
      participantId,
      eventId,
      actorUser,
      { checkCooldown: true },
    );

    // Check if participant is premium for queue priority
    const participant = await participantsService.getParticipantById(participantId);
    const isPremiumSuggestion = participant?.isPremium || false;

    const recognitionMatch = await this._resolveRecognitionMatch(
      eventId,
      title,
      artist,
      totalDuration,
      options,
    );
    const resolvedDuration = Number.isFinite(Number(totalDuration))
      ? Number(totalDuration)
      : recognitionMatch?.duration ?? undefined;

    const songData = {
      eventId,
      title,
      artist,
      requestedBy: participantId,
      status: 'PENDING',
      isPremiumSuggestion,
      sortKey: `${Date.now()}_${crypto.randomUUID()}`,
      totalDuration: resolvedDuration,
    };
    if (recognitionMatch) songData.recognitionMatch = recognitionMatch;

    const song = new SongModel(songData);

    await song.save();
    logger.info(`Song suggested: ${title} by ${artist}`);

    return this._formatSong(song);
  }

  async lookupMusicBrainz(eventId, participantId, title, artist, totalDuration, actorUser) {
    await participantsService.assertParticipantSession(
      participantId,
      eventId,
      actorUser,
      { checkCooldown: true },
    );
    if (isMusicBrainzLookupThrottled(eventId, participantId)) {
      logger.info('Attendee MusicBrainz lookup throttled', { eventId, participantId });
      return [];
    }
    markMusicBrainzLookup(eventId, participantId);

    logger.info('Attendee MusicBrainz confirmation lookup requested', {
      eventId,
      participantId,
      title,
      artist,
      totalDuration,
    });
    const matches = await musicBrainzService.findRecordingMatches(title, artist, totalDuration);
    logger.info('Attendee MusicBrainz confirmation lookup completed', {
      eventId,
      participantId,
      results: matches,
    });
    return matches;
  }

  async getMusicBrainzMatchCandidates(eventId, songId, actorUser) {
    await this._assertSongAdmin(eventId, actorUser);
    const song = await this._getSongForEvent(songId, eventId);
    const musicBrainzMatch = song.recognitionMatch;
    if (!isMusicBrainzMatch(musicBrainzMatch)) {
      throw new ValidationError('Song has no accepted MusicBrainz metadata');
    }

    const tracks = await AudioTrackModel.find({ eventId: song.eventId }).lean();
    const targetTitle = normalizeText(musicBrainzMatch.title || song.title);
    const targetArtist = normalizeText(musicBrainzMatch.artist || song.artist);
    const candidates = tracks
      .map((track) => ({
        ...formatAudioTrack(track),
        matchScore: Number((
          similarity(targetTitle, normalizeText(track.title)) * 0.65 +
          similarity(targetArtist, normalizeText(track.artist)) * 0.35
        ).toFixed(3)),
      }))
      .sort((a, b) => b.matchScore - a.matchScore);

    return {
      song: this._formatSong(song),
      musicBrainz: musicBrainzMatch,
      tracks: candidates,
    };
  }

  async getFingerprintMatchCandidates(eventId, songId, actorUser) {
    await this._assertSongAdmin(eventId, actorUser);
    const song = await this._getSongForEvent(songId, eventId);

    // Always rank against the original attendee query so the DJ can spot the
    // best library match even when the auto-assigned fingerprint is wrong.
    const targetTitle = song.title;
    const targetArtist = song.artist;

    const candidates = await this._findLocalRecognitionMatch(
      eventId,
      targetTitle,
      targetArtist,
      { strict: false, limit: 25, minScore: 0.05 },
    );

    const tracks = await AudioTrackModel.find({ eventId: song.eventId }).lean();
    const trackById = new Map(tracks.map((track) => [String(track._id), track]));

    const enriched = candidates
      .map((candidate) => {
        const track = trackById.get(String(candidate.trackId));
        if (!track) return null;
        return {
          ...formatAudioTrack(track),
          matchScore: candidate.score,
          titleScore: candidate.titleScore,
          artistScore: candidate.artistScore,
          matchedOn: candidate.matchedOn,
        };
      })
      .filter(Boolean);

    return {
      song: this._formatSong(song),
      target: { title: targetTitle, artist: targetArtist },
      recognitionMatch: hasRecognitionMatch(song.recognitionMatch)
        ? formatRecognitionMatch(song.recognitionMatch)
        : null,
      tracks: enriched,
    };
  }

  async searchFingerprints(eventId, participantId, title, artist, actorUser) {
    // Attendees can read fingerprinted tracks (metadata only) to power the
    // typeahead dropdown. We do NOT reveal the underlying audio or any DJ-only
    // metadata — just the title/artist/cover that would be useful to confirm
    // the DJ already has the track.
    await participantsService.assertParticipantSession(
      participantId,
      eventId,
      actorUser,
    );

    if (!title?.trim() && !artist?.trim()) {
      return { matches: [], query: { title: title || '', artist: artist || '' } };
    }

    const candidates = await this._findLocalRecognitionMatch(
      eventId,
      title,
      artist,
      { strict: false, limit: 8, minScore: 0.2 },
    );

    if (!candidates.length) {
      return { matches: [], query: { title: title || '', artist: artist || '' } };
    }

    const trackIds = candidates.map((candidate) => candidate.trackId);
    const tracks = await AudioTrackModel.find({
      _id: { $in: trackIds },
      eventId,
    })
      .select('title artist coverUrl duration')
      .lean();
    const trackById = new Map(tracks.map((track) => [String(track._id), track]));

    const matches = candidates
      .map((candidate) => {
        const track = trackById.get(String(candidate.trackId));
        if (!track) return null;
        return {
          trackId: track._id,
          title: track.title,
          artist: track.artist,
          coverUrl: decryptCoverUrl(track.coverUrl),
          duration: Number.isFinite(Number(track.duration))
            ? Number(track.duration)
            : null,
          matchScore: candidate.score,
          titleScore: candidate.titleScore,
          artistScore: candidate.artistScore,
          matchedOn: candidate.matchedOn,
        };
      })
      .filter(Boolean);

    return {
      matches,
      query: { title: title || '', artist: artist || '' },
    };
  }

  async assignMusicBrainzMetadataToTrack(eventId, songId, trackId, actorUser) {
    await this._assertSongAdmin(eventId, actorUser);
    if (!trackId) throw new ValidationError('Audio track ID is required');
    const song = await this._getSongForEvent(songId, eventId);
    const musicBrainzMatch = song.recognitionMatch;
    if (!isMusicBrainzMatch(musicBrainzMatch)) {
      throw new ValidationError('Song has no accepted MusicBrainz metadata');
    }

    const track = await AudioTrackModel.findOne({ _id: trackId, eventId: song.eventId });
    if (!track) throw new NotFoundError('Audio track not found');

    const metadataSha512 = musicBrainzMatch.metadataSha512 || sha512MusicBrainzMatch(musicBrainzMatch);
    track.title = musicBrainzMatch.title;
    track.artist = musicBrainzMatch.artist;
    const coverSource = await coverSourceFromMusicBrainzMatch(musicBrainzMatch);
    const coverUrl = await encryptedCoverFromSource(coverSource, actorUser?.authToken);
    if (coverUrl) track.coverUrl = coverUrl;
    track.musicBrainzMetadataSha512 = metadataSha512;
    track.musicBrainzRecordingId = musicBrainzMatch.recordingId || null;
    track.musicBrainzReleaseId = musicBrainzMatch.releaseId || null;
    track.metadataSourceSongId = song._id;

    const matchData = musicBrainzMatch.toObject?.() || musicBrainzMatch;
    song.recognitionMatch = { ...matchData, trackId: track._id, metadataSha512 };

    await Promise.all([track.save(), song.save()]);
    logger.info('Assigned MusicBrainz metadata to fingerprinted track', {
      eventId,
      songId,
      trackId,
      metadataSha512,
    });

    return {
      song: this._formatSong(song),
      track: formatAudioTrack(track),
    };
  }

  async assignFingerprintToSong(eventId, songId, trackId, actorUser) {
    await this._assertSongAdmin(eventId, actorUser);
    if (!trackId) throw new ValidationError('Audio track ID is required');

    const song = await this._getSongForEvent(songId, eventId);
    const track = await AudioTrackModel.findOne({ _id: trackId, eventId: song.eventId });
    if (!track) throw new NotFoundError('Audio track not found');

    song.recognitionMatch = {
      source: 'fingerprint',
      trackId: track._id,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl || null,
      duration: Number.isFinite(Number(track.duration)) ? Number(track.duration) : null,
      score: 1.0,
      matchedOn: 'fingerprint',
    };

    await song.save();
    logger.info('Assigned fingerprint to song', {
      eventId,
      songId,
      trackId,
    });

    return { song: this._formatSong(song) };
  }

  async getQueueForEvent(eventId) {
    const songs = await SongModel.find({
      eventId,
      status: { $in: ['APPROVED', 'PLAYING'] },
    })
      .populate('requestedBy', 'nickname profilePicture isPremium approvalCount')
      .sort(this._queueDbSort());

    return this._withQueuePositions(songs);
  }

  async getQueueSnapshotForEvent(eventId) {
    const queue = await this.getQueueForEvent(eventId);
    return {
      queue,
      nowPlaying: this._buildNowPlaying(queue),
    };
  }

  async getPendingSongsForEvent(eventId) {
    const songs = await SongModel.find({
      eventId,
      status: 'PENDING',
    })
      .populate('requestedBy', 'nickname profilePicture isPremium approvalCount')
      .sort({ isPremiumSuggestion: -1, createdAt: 1 });

    return songs.map((s) => this._formatSong(s));
  }

  async approveSong(songId, eventId, userId) {
    await this._assertSongAdmin(eventId, userId);
    const song = await this._getSongForEvent(songId, eventId);

    /* Validate state transition using state machine */
    validateTransition(song.status, 'APPROVED', 'DJ');

    if (song.recognitionMatch?.title) {
      song.title = song.recognitionMatch.title;
      song.artist = song.recognitionMatch.artist || song.artist;
    }
    song.status = 'APPROVED';
    await song.save();

    // Increment approval count for the participant who suggested this song
    const participantId = song.requestedBy;
    if (participantId) {
      await ParticipantModel.findByIdAndUpdate(participantId, {
        $inc: { approvalCount: 1 },
      });
    }

    logger.info(`Song approved: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_APPROVE',
    });
    return this._formatSong(song);
  }

  async rejectSong(songId, eventId, reason, userId) {
    await this._assertSongAdmin(eventId, userId);
    const song = await this._getSongForEvent(songId, eventId);

    /* Validate state transition using state machine */
    validateTransition(song.status, 'REJECTED', 'DJ');

    song.status = 'REJECTED';
    await song.save();

    logger.info(`Song rejected: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_REJECT',
      reason,
    });
    return this._formatSong(song);
  }

  async sendNow(songId, eventId, userId) {
    await this._assertSongAdmin(eventId, userId);
    const song = await this._getSongForEvent(songId, eventId);

    /* A song can only be pushed to Now Playing if it has a fingerprint match.
       The phone-microphone / audio-fingerprinting pipeline is the only path
       that can promote an APPROVED song to PLAYING (via sendMatchedTrackNow).
       Manual sendNow is therefore blocked until a trackId is bound. */
    this._assertPlayableMatch(song);

    /* Validate state transition using state machine */
    validateTransition(song.status, 'PLAYING', 'DJ');

    await SongModel.updateMany(
      {
        eventId: song.eventId,
        status: 'PLAYING',
        _id: { $ne: song._id },
      },
      { status: 'PLAYED' },
    );

    song.status = 'PLAYING';
    song.startedPlayingAt = new Date();
    await song.save();

    await EventModel.findByIdAndUpdate(eventId, {
      currentSongId: song._id,
    });

    logger.info(`Send now / playing: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_STATUS_CHANGE',
      newStatus: 'PLAYING',
    });
    return this._formatSong(song);
  }

  async skipSong(songId, eventId, reason, userId) {
    const context = await this._assertSongAdmin(eventId, userId);
    const song = await this._getSongForEvent(songId, eventId);

    /* Validate state transition using state machine */
    validateTransition(song.status, 'SKIPPED', 'DJ');

    song.status = 'SKIPPED';
    song.skippedAt = new Date();
    song.skippedBy = context?.userId || actorUserId(userId);
    song.skippedReason = reason;
    await song.save();

    logger.info(`Song skipped: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_SKIP',
      reason,
    });
    return this._formatSong(song);
  }

  async playNextSong(eventId, userId) {
    await this._assertSongAdmin(eventId, userId);

    /* Validate state transition before update */
    validateTransition('APPROVED', 'PLAYING', 'DJ');

    const nextSong = await SongModel.findOneAndUpdate(
      {
        eventId,
        status: 'APPROVED',
        'recognitionMatch.trackId': { $exists: true, $ne: null },
      },
      {
        status: 'PLAYING',
        startedPlayingAt: new Date(),
      },
      { new: true, sort: this._queueDbSort() },
    );

    if (nextSong) {
      logger.info(`Playing song: ${nextSong._id}`, {
        eventId,
        userId,
        songId: nextSong._id,
        action: 'SONG_STATUS_CHANGE',
        newStatus: 'PLAYING',
      });
    } else {
      logger.info('playNextSong skipped - no playable (matched) approved song', {
        eventId,
        userId,
        action: 'SONG_STATUS_CHANGE',
        newStatus: 'PLAYING',
      });
    }

    return nextSong ? this._formatSong(nextSong) : null;
  }

  async markSongAsPlayed(songId, eventId, userId) {
    await this._assertSongAdmin(eventId, userId);
    const song = await this._getSongForEvent(songId, eventId);

    /* Validate state transition using state machine */
    validateTransition(song.status, 'PLAYED', 'DJ');

    song.status = 'PLAYED';
    await song.save();

    logger.info(`Song marked as played: ${song._id}`, {
      eventId,
      userId,
      songId: song._id,
      action: 'SONG_STATUS_CHANGE',
      newStatus: 'PLAYED',
    });
    return this._formatSong(song);
  }

  async getSongPosition(songId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    const queue = await this.getQueueForEvent(song.eventId);
    const queuedSong = queue.find((item) => item._id.toString() === songId.toString());

    return {
      position: queuedSong?.queuePosition ?? null,
      song: queuedSong || this._formatSong(song),
    };
  }

  async getSongStats(songId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }

    return {
      ...this._formatSong(song),
      voteScore: song.voteScore,
      voteCount: song.voteCount,
    };
  }

  _withQueuePositions(songs) {
    let queuedPosition = 0;
    return songs
      .slice()
      .sort((a, b) => {
        if (a.status === 'PLAYING' && b.status !== 'PLAYING') return -1;
        if (b.status === 'PLAYING' && a.status !== 'PLAYING') return 1;
        if (Number(b.pinned) !== Number(a.pinned)) {
          return Number(b.pinned) - Number(a.pinned);
        }
        const voteDiff = (b.voteScore || 0) - (a.voteScore || 0);
        if (voteDiff) return voteDiff;
        if (Number(b.isPremiumSuggestion) !== Number(a.isPremiumSuggestion)) {
          return Number(b.isPremiumSuggestion) - Number(a.isPremiumSuggestion);
        }
        return String(a.sortKey).localeCompare(String(b.sortKey));
      })
      .map((song) => {
        const formatted = this._formatSong(song);
        formatted.queuePosition =
          song.status === 'PLAYING' ? 0 : ++queuedPosition;
        return formatted;
      });
  }

  _buildNowPlaying(queue) {
    const playing = queue.find((song) => song.status === 'PLAYING');
    if (!playing) return null;

    const startedAt = playing.playingStartedAt || playing.startedPlayingAt;
    const elapsedTime = startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : 0;
    const totalDuration = playing.totalDuration || playing.duration || 0;

    return {
      songId: playing._id || playing.id,
      title: playing.title,
      artist: playing.artist,
      totalDuration,
      duration: totalDuration,
      playingStartedAt: startedAt,
      startedPlayingAt: startedAt,
      elapsedTime,
      remainingTime: totalDuration ? Math.max(0, totalDuration - elapsedTime) : null,
    };
  }

  _formatSong(song) {
    const totalDuration = song.totalDuration ?? song.duration;
    const recognitionMatch = hasRecognitionMatch(song.recognitionMatch)
      ? formatRecognitionMatch(song.recognitionMatch)
      : null;

    return {
      _id: song._id,
      id: song._id,
      eventId: song.eventId,
      title: song.title,
      artist: song.artist,
      recognitionMatch,
      requestedBy: song.requestedBy,
      status: song.status,
      voteScore: song.voteScore,
      voteCount: song.voteCount,
      queuePosition: song.queuePosition,
      isPremiumSuggestion: song.isPremiumSuggestion,
      totalDuration,
      duration: totalDuration,
      pinned: song.pinned,
      startedPlayingAt: song.startedPlayingAt,
      playingStartedAt: song.startedPlayingAt,
      skippedAt: song.skippedAt,
      createdAt: song.createdAt,
    };
  }

  _queueDbSort() {
    return {
      pinned: -1,
      voteScore: -1,
      isPremiumSuggestion: -1,
      sortKey: 1,
    };
  }

  async _findRecognitionMatch(eventId, title, artist, totalDuration) {
    // Wrap MusicBrainz in its own try/catch to prevent network failures from crashing
    const safeMusicBrainz = (async () => {
      try {
        return await musicBrainzService.findRecordingMatch(title, artist, totalDuration);
      } catch (err) {
        logger.warn('MusicBrainz lookup failed', {
          message: err.message,
          cause: err.cause ? err.cause.code || err.cause.message || String(err.cause) : null,
        });
        return null;
      }
    })();

    // Strict local pass: only high-confidence candidates (used to win against MB)
    const strictLocal = this._findLocalRecognitionMatch(eventId, title, artist, {
      strict: true,
      limit: 1,
    });

    const [localMatch, musicBrainzMatch] = await Promise.all([
      strictLocal,
      safeMusicBrainz,
    ]);

    // MusicBrainz is the primary metadata source — never replace a MB match
    // with a local one purely on score. Local only takes over as a fallback.
    if (musicBrainzMatch) {
      if (localMatch) {
        logger.debug('MusicBrainz match wins over local candidate', {
          eventId,
          musicbrainzScore: musicBrainzMatch.score,
          localScore: localMatch.score,
        });
      }
      return musicBrainzMatch;
    }

    if (localMatch) {
      logger.info('Local fingerprint match used (no MusicBrainz match found)', {
        eventId,
        title,
        artist,
        score: localMatch.score,
        matchedOn: localMatch.matchedOn,
      });
      return { ...localMatch, fallbackUsed: true };
    }

    // Lenient fallback: MusicBrainz returned no match and no strict local
    // candidate passed — widen the threshold and capture the top candidates
    // so the DJ can review and pick the right track.
    const lenientCandidates = await this._findLocalRecognitionMatch(
      eventId,
      title,
      artist,
      { strict: false, limit: 5, minScore: 0.35 },
    );

    if (!lenientCandidates || lenientCandidates.length === 0) {
      logger.info('No recognition match found (MusicBrainz empty, no local candidate)', {
        eventId,
        title,
        artist,
      });
      return null;
    }

    const alternates = lenientCandidates
      .slice(1)
      .map((candidate) => ({
        trackId: candidate.trackId,
        title: candidate.title,
        artist: candidate.artist,
        coverUrl: candidate.coverUrl || null,
        duration: candidate.duration,
        score: candidate.score,
        matchedOn: candidate.matchedOn,
      }));

    const best = lenientCandidates[0];
    logger.info('Lenient local fingerprint fallback used (MusicBrainz failed)', {
      eventId,
      title,
      artist,
      candidateCount: lenientCandidates.length,
      bestScore: best.score,
      bestMatchedOn: best.matchedOn,
    });

    return {
      ...best,
      matchedOn: best.matchedOn || 'lenient',
      alternates,
      fallbackUsed: true,
    };
  }

  async _resolveRecognitionMatch(eventId, title, artist, totalDuration, options) {
    if (options.musicBrainzConfirmed && options.musicBrainzMatch?.title && options.musicBrainzMatch?.artist) {
      const musicBrainzMatch = {
        ...options.musicBrainzMatch,
        source: 'musicbrainz',
        metadataSha512: sha512MusicBrainzMatch(options.musicBrainzMatch),
      };
      logger.info('Using attendee-confirmed MusicBrainz metadata', {
        eventId,
        title,
        artist,
        match: musicBrainzMatch,
      });
      return musicBrainzMatch;
    }

    if (options.skipMusicBrainzLookup) {
      logger.info('Attendee declined MusicBrainz metadata; sending request as entered', {
        eventId,
        title,
        artist,
      });
      return null;
    }

    return this._findRecognitionMatch(eventId, title, artist, totalDuration);
  }

  async _findLocalRecognitionMatch(eventId, title, artist, options = {}) {
    const { strict = true, limit = 1, minScore = 0 } = options;
    const targetTitle = normalizeText(title);
    const targetArtist = normalizeText(artist);
    if (!targetTitle && !targetArtist) return strict ? null : [];

    const tracks = await AudioTrackModel.find({ eventId })
      .select('title artist coverUrl duration')
      .lean();

    const candidates = [];
    for (const track of tracks) {
      const trackTitle = normalizeText(track.title);
      const trackArtist = normalizeText(track.artist);
      const titleScore = similarity(targetTitle, trackTitle);
      const artistScore = similarity(targetArtist, trackArtist);
      const score = (titleScore * 0.65) + (artistScore * 0.35);

      if (score < minScore) continue;

      let matchedOn = null;
      if (strict) {
        matchedOn =
          titleScore >= 0.82 && artistScore >= 0.72
            ? 'title_artist'
            : titleScore >= 0.86
              ? 'title'
              : artistScore >= 0.9
                ? 'artist'
                : null;
        if (!matchedOn) continue;
      } else {
        matchedOn =
          titleScore >= 0.82 && artistScore >= 0.72
            ? 'title_artist'
            : titleScore >= 0.86
              ? 'title'
              : artistScore >= 0.9
                ? 'artist'
                : 'lenient';
      }

      candidates.push({
        source: 'local',
        trackId: track._id,
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl || null,
        duration: Number.isFinite(Number(track.duration)) ? Number(track.duration) : null,
        score: Number(score.toFixed(3)),
        titleScore: Number(titleScore.toFixed(3)),
        artistScore: Number(artistScore.toFixed(3)),
        matchedOn,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const capped = candidates.slice(0, limit);
    return strict ? capped[0] || null : capped;
  }

  async _assertSongAdmin(eventId, actorUser) {
    return eventPermissionsService.assertSongAdmin(eventId, actorUser);
  }

  // Helper: Get song and validate ownership for a specific event
  async _getSongForEvent(songId, eventId) {
    const song = await SongModel.findById(songId);
    if (!song) {
      throw new NotFoundError('Song not found');
    }
    if (song.eventId.toString() !== eventId.toString()) {
      throw new NotFoundError('Song not in this event');
    }
    return song;
  }

  // Helper: A song can only be promoted to Now Playing once a fingerprint
  // match is bound (recognitionMatch.trackId). Until then the audio
  // fingerprinting pipeline (sendMatchedTrackNow) is the only path that may
  // flip it to PLAYING. The DJ must wait for the microphone to match it.
  _assertPlayableMatch(song) {
    if (!song.recognitionMatch?.trackId) {
      throw new MatchRequiredError();
    }
  }
}

function actorUserId(actor) {
  if (typeof actor === 'string') return actor;
  return actor?.userId?.toString() || actor?._id?.toString() || actor?.id?.toString() || null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasRecognitionMatch(match) {
  return Boolean(match?.title && match?.artist && Number.isFinite(Number(match.score)));
}

function isMusicBrainzMatch(match) {
  return hasRecognitionMatch(match) && match.source === 'musicbrainz';
}

function sha512MusicBrainzMatch(match) {
  const canonical = JSON.stringify({
    source: 'musicbrainz',
    recordingId: match.recordingId || null,
    releaseId: match.releaseId || null,
    title: match.title || null,
    artist: match.artist || null,
    coverUrl: match.coverUrl || null,
    duration: Number.isFinite(Number(match.duration)) ? Number(match.duration) : null,
    score: Number.isFinite(Number(match.score)) ? Number(match.score) : null,
    matchedOn: match.matchedOn || null,
  });
  return crypto.createHash('sha512').update(canonical).digest('hex');
}

function formatAudioTrack(track) {
  return {
    id: track._id,
    _id: track._id,
    eventId: track.eventId,
    title: track.title,
    artist: track.artist,
    coverUrl: decryptCoverUrl(track.coverUrl),
    audioSha256: track.audioSha256 || null,
    duration: track.duration,
    sampleRate: track.sampleRate,
    pointsCount: track.pointsCount,
    hashesCount: track.hashesCount,
    musicBrainzMetadataSha512: track.musicBrainzMetadataSha512 || null,
    musicBrainzRecordingId: track.musicBrainzRecordingId || null,
    musicBrainzReleaseId: track.musicBrainzReleaseId || null,
    metadataSourceSongId: track.metadataSourceSongId || null,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt,
  };
}

function formatRecognitionMatch(match) {
  const plain = match.toObject?.() || match;
  const alternates = Array.isArray(plain.alternates)
    ? plain.alternates.map((alt) => ({
        ...alt,
        coverUrl: decryptCoverUrl(alt.coverUrl),
      }))
    : [];
  return {
    ...plain,
    coverUrl: decryptCoverUrl(plain.coverUrl),
    alternates,
    fallbackUsed: Boolean(plain.fallbackUsed),
  };
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  const tokenScore = overlap ? (2 * overlap) / (aTokens.size + bTokens.size) : 0;
  const editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(tokenScore, editScore);
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? prev
        : Math.min(prev, row[j - 1], row[j]) + 1;
      prev = next;
    }
  }
  return row[b.length];
}

module.exports = new SongsService();

function isMusicBrainzLookupThrottled(eventId, participantId) {
  const key = musicBrainzLookupKey(eventId, participantId);
  const lastLookupAt = musicBrainzLookupThrottle.get(key) || 0;
  return Date.now() - lastLookupAt < MUSICBRAINZ_LOOKUP_THROTTLE_MS;
}

function markMusicBrainzLookup(eventId, participantId) {
  musicBrainzLookupThrottle.set(musicBrainzLookupKey(eventId, participantId), Date.now());
}

function musicBrainzLookupKey(eventId, participantId) {
  return `${eventId}:${participantId}`;
}

async function encryptedCoverFromSource(coverUrl, token) {
  if (!coverUrl) return null;
  if (String(coverUrl).startsWith('data:image/')) return encryptCoverUrl(coverUrl, token);
  if (!/^https:\/\//i.test(String(coverUrl))) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COVER_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(coverUrl, {
      headers: { Accept: 'image/*' },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!contentType.startsWith('image/')) return null;

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_COVER_DOWNLOAD_BYTES) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_COVER_DOWNLOAD_BYTES) return null;

    return encryptCoverUrl(`data:${contentType};base64,${bytes.toString('base64')}`, token);
  } catch (error) {
    logger.warn('MusicBrainz cover download failed', { message: error.message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function coverSourceFromMusicBrainzMatch(match) {
  if (match?.coverUrl) return match.coverUrl;
  if (!match?.recordingId) return null;
  const summary = await musicBrainzService.lookupRecordingSummary(match.recordingId);
  return summary?.coverUrl || null;
}
