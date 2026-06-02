const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  AudioFingerprintHashModel,
  AudioFingerprintPointModel,
  AudioTrackModel,
  EventMemberModel,
  EventModel,
} = require('../models/schema');
const { ForbiddenError, NotFoundError, ValidationError } = require('../errors');
const { createConstellation } = require('./audio-recognition/constellation');
const { createHashes } = require('./audio-recognition/hashes');
const { readWav } = require('./audio-recognition/wav');
const { matchHashes } = require('./audio-recognition/mongo-matcher');

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
]);
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const INSERT_CHUNK = 5000;
const OBJECT_ID = /^[a-f\d]{24}$/i;

class AudioTracksService {
  async createTrack(eventId, actor, fields, file) {
    const { userId, eventObjectId } = await this._assertDj(eventId, actor);
    this._assertWavUpload(file);

    const title = cleanRequired(fields.title, 'title');
    const artist = cleanRequired(fields.artist, 'artist');
    const tmpFile = await writeTempFile(file);

    try {
      const { sampleRate, samples } = readWav(tmpFile);
      const points = createConstellation(samples, sampleRate);
      const hashRows = [...createHashes(points)];

      const track = await AudioTrackModel.create({
        eventId: eventObjectId,
        title,
        artist,
        uploadedBy: userId,
        duration: samples.length / sampleRate,
        sampleRate,
        pointsCount: points.length,
        hashesCount: hashRows.length,
      });

      await insertManyChunked(
        AudioFingerprintPointModel,
        points.map(([time, frequency]) => ({
          eventId: eventObjectId,
          trackId: track._id,
          time,
          frequency,
        })),
      );
      await insertManyChunked(
        AudioFingerprintHashModel,
        hashRows.map(([hash, [sourceTime]]) => ({
          eventId: eventObjectId,
          trackId: track._id,
          hash,
          sourceTime,
        })),
      );

      return this._formatTrack(track);
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
      AudioFingerprintHashModel.deleteMany({ eventId: eventObjectId, trackId }),
      AudioFingerprintPointModel.deleteMany({ eventId: eventObjectId, trackId }),
      AudioTrackModel.deleteOne({ _id: trackId, eventId: eventObjectId }),
    ]);

    return this._formatTrack(track);
  }

  async matchWav(eventId, actor, file) {
    const { eventObjectId } = await this._assertDj(eventId, actor);
    this._assertWavUpload(file);
    const tmpFile = await writeTempFile(file);

    try {
      const { sampleRate, samples } = readWav(tmpFile);
      const points = createConstellation(samples, sampleRate);
      const hashes = [...createHashes(points)].map(([hash, [time]]) => ({ hash, time }));
      return matchHashes(eventObjectId, hashes);
    } finally {
      fs.promises.rm(tmpFile, { force: true }).catch(() => {});
    }
  }

  async matchHashes(eventId, hashes) {
    return matchHashes(eventId, hashes);
  }

  async _assertDj(eventId, actor) {
    const userId =
      typeof actor === 'string'
        ? actor
        : actor?.userId?.toString() || actor?._id?.toString() || actor?.id?.toString();
    if (!userId) throw new ForbiddenError('DJ authentication is required');
    const event = await this._findEvent(eventId);
    if (actor?.role === 'ADMIN') return { userId, eventObjectId: event._id };

    if (event.ownerId?.toString() === userId) {
      return { userId, eventObjectId: event._id };
    }

    const member = await EventMemberModel.findOne({ eventId: event._id, userId })
      .select('role permissions')
      .lean();
    if (member?.role === 'DJ' || member?.permissions?.includes('SONG_APPROVE_REJECT')) {
      return { userId, eventObjectId: event._id };
    }

    throw new ForbiddenError('You do not have permission to manage audio fingerprints');
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

async function writeTempFile(file) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'syncrekuest-audio-'));
  const tmpFile = path.join(dir, `${Date.now()}-${path.basename(file.filename || 'audio.wav')}`);
  await fs.promises.writeFile(tmpFile, file.buffer);
  return tmpFile;
}

async function insertManyChunked(model, rows) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await model.insertMany(rows.slice(i, i + INSERT_CHUNK), { ordered: false });
  }
}

module.exports = new AudioTracksService();
