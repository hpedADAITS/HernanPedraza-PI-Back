const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  AudioFingerprintModel,
  AudioTrackModel,
  EventModel,
  SongModel,
} = require('../models/schema');
const { ForbiddenError, NotFoundError, ValidationError } = require('../errors');
const eventPermissionsService = require('./event-permissions.service');
const songsService = require('./songs.service');
const { coverUrlCacheKey, decryptCoverUrl, encryptCoverUrl } = require('./cover-url-crypto');
const { fingerprintWavStreamed } = require('./audio-recognition/fingerprint');
const { encodeHashRows } = require('./audio-recognition/fingerprint-codec');
const { matchHashes, RamMatcher } = require('./audio-recognition/ram-matcher');
const { parseWavHeader, TARGET_SAMPLE_RATE } = require('./audio-recognition/wav');
const musicBrainzService = require('./musicbrainz.service');
const { evaluateAbsoluteGates } = require('./audio-recognition/match-thresholds');
const { enrichMatchesWithQueueContext } = require('./audio-recognition/queue-linker');

// Shared RamMatcher instance for socket-level matching
const sharedRamMatcher = new RamMatcher();

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
]);
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const INSERT_CHUNK = 5000;
const OBJECT_ID = /^[a-f\d]{24}$/i;

async function computeAudioSha256(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

class AudioTracksService {
  async createTrack(eventId, actor, fields, file) {
    const { userId, eventObjectId } = await this._assertDj(eventId, actor);
    this._assertWavUpload(file);

    const title = cleanRequired(fields.title, 'title');
    const artist = cleanRequired(fields.artist, 'artist');
    const coverUrl = encryptCoverUrl(cleanOptional(fields.coverUrl), actor?.authToken);
    const tmpFile = await writeTempFile(file);

    try {
      const audioSha256 = await computeAudioSha256(tmpFile);

      // Check for duplicate upload
      const existing = await AudioTrackModel.findOne({
        eventId: eventObjectId,
        audioSha256,
      }).lean();
      if (existing) {
        throw new ValidationError(
          'This audio file has already been uploaded to this event'
        );
      }

      const header = await parseWavHeader(tmpFile);
      const bytesPerFrame = (header.fmt.bits >>> 3) * header.fmt.channels;
      const totalFrames = Math.floor(header.dataSize / bytesPerFrame);
      const expectedDuration = totalFrames / header.fmt.sampleRate;

      const track = await AudioTrackModel.create({
        eventId: eventObjectId,
        audioSha256,
        title,
        artist,
        coverUrl,
        uploadedBy: userId,
        duration: expectedDuration,
        sampleRate: TARGET_SAMPLE_RATE,
        pointsCount: 0,
        hashesCount: 0,
      });

      await AudioFingerprintModel.create({
        eventId: eventObjectId,
        trackId: track._id,
        sampleRate: TARGET_SAMPLE_RATE,
        duration: expectedDuration,
        pointsCount: 0,
        hashesCount: 0,
      });

      const hashChunks = [];
      const totals = await fingerprintWavStreamed(tmpFile, {
        batchSize: INSERT_CHUNK,
        onBatch: async (batch) => {
          hashChunks.push(encodeHashRows(batch));
        },
      });
      const hashData = Buffer.concat(hashChunks);

      await Promise.all([
        AudioTrackModel.updateOne(
          { _id: track._id },
          {
            duration: totals.duration,
            sampleRate: totals.sampleRate,
            pointsCount: totals.pointsCount,
            hashesCount: totals.hashesCount,
          }
        ),
        AudioFingerprintModel.updateOne(
          { trackId: track._id },
          {
            $set: {
              sampleRate: totals.sampleRate,
              duration: totals.duration,
              pointsCount: totals.pointsCount,
              hashesCount: totals.hashesCount,
              hashData,
            },
            $unset: { hashes: 1 },
          }
        ),
      ]);

      const updated = await AudioTrackModel.findById(track._id).lean();
      return this._formatTrack(updated);
    } catch (error) {
      throw error instanceof ValidationError
        ? error
        : new ValidationError(`Unable to fingerprint WAV audio: ${error.message}`);
    } finally {
      fs.promises.rm(tmpFile, { force: true }).catch(() => {});
    }
  }

  async listTracks(eventId, actor, options = {}) {
    const { eventObjectId } = await this._assertDj(eventId, actor);
    const cachedCoverKeys = new Set(options.cachedCoverKeys || []);
    const tracks = await AudioTrackModel.find({ eventId: eventObjectId })
      .sort({ createdAt: -1 })
      .lean();

    const trackIds = tracks.map((t) => t._id);
    const songCounts = await SongModel.aggregate([
      {
        $match: {
          eventId: eventObjectId,
          'recognitionMatch.trackId': { $in: trackIds },
        },
      },
      { $group: { _id: '$recognitionMatch.trackId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(songCounts.map((r) => [String(r._id), r.count]));

    const enriched = await Promise.all(
      tracks.map(async (track) => {
        const formatted = this._formatTrack(track, { cachedCoverKeys });
        let musicBrainz = null;
        if (formatted.musicBrainzRecordingId) {
          const summary = await musicBrainzService.lookupRecordingSummary(
            formatted.musicBrainzRecordingId,
          );
          if (summary) {
            musicBrainz = {
              title: summary.title,
              artist: summary.artist,
              coverUrl: decryptCoverUrl(summary.coverUrl),
              metadataSha512: formatted.musicBrainzMetadataSha512,
            };
          }
        }
        return {
          ...formatted,
          musicBrainz,
          songsAttached: countMap[String(track._id)] || 0,
        };
      }),
    );

    return enriched;
  }

  async deleteTrack(eventId, trackId, actor) {
    const { eventObjectId } = await this._assertDj(eventId, actor);

    const track = await AudioTrackModel.findOne({ _id: trackId, eventId: eventObjectId });
    if (!track) throw new NotFoundError('Audio track not found');

    await Promise.all([
      AudioFingerprintModel.deleteMany({ eventId: eventObjectId, trackId }),
      AudioTrackModel.deleteOne({ _id: trackId, eventId: eventObjectId }),
    ]);

    return this._formatTrack(track);
  }

  async matchWav(eventId, actor, file) {
    const { eventObjectId } = await this._assertDj(eventId, actor);
    this._assertWavUpload(file);
    const tmpFile = await writeTempFile(file);

    try {
      const collected = [];
      await fingerprintWavStreamed(tmpFile, {
        onBatch: async (batch) => {
          collected.push(...batch);
        },
      });
      const hashes = collected.map(({ hash, time }) => ({ hash, time }));
      return this.matchHashes(eventObjectId, hashes);
    } finally {
      fs.promises.rm(tmpFile, { force: true }).catch(() => {});
    }
  }

  // The REST entry-point. It applies the *absolute* tolerance gates
  // (min score + offset concentration) so a noise query can never
  // surface a fake winner, but it deliberately does NOT apply the
  // margin-to-runner-up gate — that is reserved for the streaming
  // path, where a clear single winner is the UX contract. The REST
  // endpoint can return multiple candidates so the DJ can pick
  // manually. All results are enriched with queue context so the
  // caller learns whether the track is already in the queue.
  async matchHashes(eventId, hashes) {
    const eventIdString = eventId ? String(eventId) : '';
    const ranked = await matchHashes(eventIdString, hashes);
    const surviving = ranked.filter((match) => evaluateAbsoluteGates(match).passed);
    if (!surviving.length) return [];
    return enrichMatchesWithQueueContext(eventIdString, surviving);
  }

  async sendMatchedTrackNow(eventId, actor, trackId) {
    const { eventObjectId, eventActor } =
      actor?.type === 'phone-microphone'
        ? await this._assertPhoneMicrophone(eventId, actor)
        : await this._assertDj(eventId, actor);
    const track = await AudioTrackModel.findOne({ _id: trackId, eventId: eventObjectId }).lean();
    if (!track) throw new NotFoundError('Audio track not found');

    const song = await SongModel.findOne({
      eventId: eventObjectId,
      status: { $in: ['APPROVED', 'PLAYING'] },
      'recognitionMatch.trackId': track._id.toString(),
    })
      .sort({ queuePosition: 1, approvedAt: 1, createdAt: 1 })
      .lean();

    if (!song) throw new NotFoundError('No queued song matches this audio track');
    return songsService.sendNow(song._id, eventObjectId, eventActor || actor);
  }

  async _assertDj(eventId, actor) {
    const context = await eventPermissionsService.assertAnyPermission(
      eventId,
      actor,
      ['SONG_APPROVE_REJECT'],
      'You do not have permission to manage audio fingerprints',
    );
    return { userId: context.userId, eventObjectId: context.event._id };
  }

  async _assertPhoneMicrophone(eventId, actor) {
    const event = await this._findEvent(eventId);
    const eventIdString = event._id.toString();
    const ownerId = event.ownerId.toString();
    if (actor.eventId !== eventIdString || actor.userId !== ownerId) {
      throw new ForbiddenError('Invalid phone microphone token');
    }
    return {
      userId: ownerId,
      eventObjectId: event._id,
      eventActor: { userId: ownerId, role: 'DJ' },
    };
  }


  async _findEvent(eventId) {
    const event = OBJECT_ID.test(String(eventId || ''))
      ? await EventModel.findById(eventId).select('ownerId').lean()
      : await EventModel.findOne({ eventId: String(eventId || '').toUpperCase() })
        .select('ownerId')
        .lean();

    if (!event) throw new NotFoundError('Event not found');
    return event;
  }

  _assertWavUpload(file) {
    if (!file?.buffer?.length) throw new ValidationError('Audio file is required');
    if (file.buffer.length > MAX_UPLOAD_BYTES) throw new ValidationError('Audio file is too large');
    const ext = path.extname(file.filename || '').toLowerCase();
    if (!ALLOWED_AUDIO_TYPES.has(file.contentType) && ext !== '.wav') {
      throw new ValidationError('Upload browser-converted WAV audio');
    }
  }

  _formatTrack(track, options = {}) {
    const cacheKey = coverUrlCacheKey(track.coverUrl);
    const coverCached = cacheKey && options.cachedCoverKeys?.has(cacheKey);
    return {
      id: track._id,
      _id: track._id,
      eventId: track.eventId,
      title: track.title,
      artist: track.artist,
      coverUrl: coverCached ? null : decryptCoverUrl(track.coverUrl),
      coverUrlCacheKey: cacheKey,
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
}

function cleanRequired(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
}

function cleanOptional(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function writeTempFile(file) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'Syncrequest-audio-'));
  const tmpFile = path.join(dir, `${Date.now()}-${path.basename(file.filename || 'audio.wav')}`);
  await fs.promises.writeFile(tmpFile, file.buffer);
  return tmpFile;
}

const audioTracksServiceInstance = new AudioTracksService();

module.exports = audioTracksServiceInstance;
module.exports.audioTracksService = audioTracksServiceInstance;
module.exports.sharedRamMatcher = sharedRamMatcher;
