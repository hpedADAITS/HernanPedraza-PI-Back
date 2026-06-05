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
const { fingerprintWavStreamed } = require('./audio-recognition/fingerprint');
const { matchHashes, RamMatcher } = require('./audio-recognition/ram-matcher');
const { parseWavHeader, TARGET_SAMPLE_RATE } = require('./audio-recognition/wav');

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

function computeAudioSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

class AudioTracksService {
  async createTrack(eventId, actor, fields, file) {
    const { userId, eventObjectId } = await this._assertDj(eventId, actor);
    this._assertWavUpload(file);

    const title = cleanRequired(fields.title, 'title');
    const artist = cleanRequired(fields.artist, 'artist');
    const coverUrl = cleanOptional(fields.coverUrl);
    const tmpFile = await writeTempFile(file);

    try {
      const buffer = await fs.promises.readFile(tmpFile);
      const audioSha256 = computeAudioSha256(buffer);

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

      // Seed the bundled fingerprint document with an empty hashes array
      // and stream $push batches in to bound memory.
      await AudioFingerprintModel.create({
        eventId: eventObjectId,
        trackId: track._id,
        sampleRate: TARGET_SAMPLE_RATE,
        duration: expectedDuration,
        pointsCount: 0,
        hashesCount: 0,
        hashes: [],
      });

      const totals = await fingerprintWavStreamed(tmpFile, {
        batchSize: INSERT_CHUNK,
        onBatch: async (batch) => {
          await AudioFingerprintModel.updateOne(
            { trackId: track._id },
            { $push: { hashes: { $each: batch.map(({ hash, time }) => ({ h: hash, t: time })) } } }
          );
        },
      });

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
            sampleRate: totals.sampleRate,
            duration: totals.duration,
            pointsCount: totals.pointsCount,
            hashesCount: totals.hashesCount,
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

  async listTracks(eventId, actor) {
    const { eventObjectId } = await this._assertDj(eventId, actor);
    const tracks = await AudioTrackModel.find({ eventId: eventObjectId })
      .sort({ createdAt: -1 })
      .lean();
    return tracks.map((track) => this._formatTrack(track));
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
      return matchHashes(eventObjectId, hashes);
    } finally {
      fs.promises.rm(tmpFile, { force: true }).catch(() => {});
    }
  }

  async matchHashes(eventId, hashes) {
    return matchHashes(eventId, hashes);
  }

  async sendMatchedTrackNow(eventId, actor, trackId) {
    const { eventObjectId } = await this._assertDj(eventId, actor);
    const track = await AudioTrackModel.findOne({ _id: trackId, eventId: eventObjectId }).lean();
    if (!track) throw new NotFoundError('Audio track not found');

    const song = await SongModel.findOne({
      eventId: eventObjectId,
      status: { $in: ['APPROVED', 'QUEUED', 'PLAYING'] },
      'recognitionMatch.trackId': track._id.toString(),
    })
      .sort({ queuePosition: 1, approvedAt: 1, createdAt: 1 })
      .lean();

    if (!song) throw new NotFoundError('No queued song matches this audio track');
    return songsService.sendNow(song._id, eventObjectId, actor);
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

  _formatTrack(track) {
    return {
      id: track._id,
      _id: track._id,
      eventId: track.eventId,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl || null,
      duration: track.duration,
      sampleRate: track.sampleRate,
      pointsCount: track.pointsCount,
      hashesCount: track.hashesCount,
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
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'syncrekuest-audio-'));
  const tmpFile = path.join(dir, `${Date.now()}-${path.basename(file.filename || 'audio.wav')}`);
  await fs.promises.writeFile(tmpFile, file.buffer);
  return tmpFile;
}

const audioTracksServiceInstance = new AudioTracksService();

module.exports = audioTracksServiceInstance;
module.exports.audioTracksService = audioTracksServiceInstance;
module.exports.sharedRamMatcher = sharedRamMatcher;
