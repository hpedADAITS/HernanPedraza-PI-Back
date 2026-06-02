const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const AudioFingerprintPointSchema = new Schema(
  {
    trackId: {
      type: Schema.Types.ObjectId,
      ref: 'AudioTrack',
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    time: { type: Number, required: true, min: 0 },
    frequency: { type: Number, required: true, min: 0 },
  },
  { timestamps: false },
);

AudioFingerprintPointSchema.index({ eventId: 1, trackId: 1 });

const AudioFingerprintPointModel = model(
  'AudioFingerprintPoint',
  AudioFingerprintPointSchema,
  'audio_fingerprint_points',
);

module.exports = { AudioFingerprintPointModel };
