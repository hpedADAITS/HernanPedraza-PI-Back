const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const AudioTrackSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    artist: { type: String, required: true, trim: true },
    coverUrl: { type: String, trim: true, default: null },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    duration: { type: Number, required: true, min: 0 },
    sampleRate: { type: Number, required: true, min: 1 },
    pointsCount: { type: Number, required: true, min: 0 },
    hashesCount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

AudioTrackSchema.index({ eventId: 1, title: 1, artist: 1 });

const AudioTrackModel = model('AudioTrack', AudioTrackSchema, 'audio_tracks');

module.exports = { AudioTrackModel };
