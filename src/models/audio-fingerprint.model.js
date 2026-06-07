"use strict";

const mongoose = require("mongoose");

const { Schema, model } = mongoose;

const AudioFingerprintSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },

    trackId: {
      type: Schema.Types.ObjectId,
      ref: "AudioTrack",
      required: true,
      unique: true,
      index: true,
    },

    sampleRate: {
      type: Number,
      required: true,
      default: 16000,
    },

    duration: {
      type: Number,
      required: true,
    },

    pointsCount: {
      type: Number,
      required: true,
    },

    hashesCount: {
      type: Number,
      required: true,
    },

    hashData: {
      type: Buffer,
      default: undefined,
    },

    hashes: {
      type: [
        new Schema(
          {
            h: {
              type: Number,
              required: true,
            },
            t: {
              type: Number,
              required: true,
            },
          },
          { _id: false }
        ),
      ],
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

AudioFingerprintSchema.index({ eventId: 1, trackId: 1 });

const AudioFingerprintModel = model(
  "AudioFingerprint",
  AudioFingerprintSchema,
  "audio_fingerprints"
);

// Guardrails for fingerprint size (matching FIX.md recommendations)
const MAX_TRACK_FINGERPRINT_HASHES = 80_000;
const MAX_EVENT_FINGERPRINT_HASHES = 250_000;

module.exports = {
  AudioFingerprintModel,
  MAX_TRACK_FINGERPRINT_HASHES,
  MAX_EVENT_FINGERPRINT_HASHES,
};
