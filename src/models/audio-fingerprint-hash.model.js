const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const AudioFingerprintHashSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    hash: { type: Number, required: true },
    trackId: {
      type: Schema.Types.ObjectId,
      ref: 'AudioTrack',
      required: true,
      index: true,
    },
    sourceTime: { type: Number, required: true, min: 0 },
  },
  { timestamps: false },
);

AudioFingerprintHashSchema.index({ eventId: 1, hash: 1 });
AudioFingerprintHashSchema.index({ eventId: 1, trackId: 1 });

const AudioFingerprintHashModel = model(
  'AudioFingerprintHash',
  AudioFingerprintHashSchema,
  'audio_fingerprint_hashes',
);

module.exports = { AudioFingerprintHashModel };
