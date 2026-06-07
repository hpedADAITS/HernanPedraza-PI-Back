const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const SongSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },

    title: { type: String, required: true, trim: true },
    artist: { type: String, required: true, trim: true },
    recognitionMatch: {
      trackId: { type: Schema.Types.ObjectId, ref: 'AudioTrack' },
      source: { type: String, enum: ['local', 'musicbrainz'] },
      recordingId: { type: String, trim: true },
      releaseId: { type: String, trim: true },
      metadataSha512: { type: String, trim: true },
      title: { type: String, trim: true },
      artist: { type: String, trim: true },
      coverUrl: { type: String, trim: true },
      duration: { type: Number, min: 0 },
      score: { type: Number, min: 0, max: 1 },
      matchedOn: { type: String, enum: ['title', 'artist', 'title_artist', 'lenient'] },
      /* When MusicBrainz returns no match, the backend falls back to the DJ's
         fingerprinted library and stores the top candidates here so the DJ
         can review and pick the right track from the picker dialog. */
      alternates: [
        {
          trackId: { type: Schema.Types.ObjectId, ref: 'AudioTrack' },
          title: { type: String, trim: true },
          artist: { type: String, trim: true },
          coverUrl: { type: String, trim: true, default: null },
          duration: { type: Number, min: 0 },
          score: { type: Number, min: 0, max: 1 },
          matchedOn: { type: String, enum: ['title', 'artist', 'title_artist', 'lenient'] },
        },
      ],
      fallbackUsed: { type: Boolean, default: false },
    },

    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Participant',
      required: true,
      index: true,
    },

    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'APPROVED', 'PLAYING', 'PLAYED', 'SKIPPED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },

    voteScore: { type: Number, default: 0, index: true },
    voteCount: { type: Number, default: 0 },

    queuePosition: { type: Number, index: true },
    isPremiumSuggestion: { type: Boolean, default: false, index: true },

    totalDuration: { type: Number, min: 0 },

    sortKey: { type: String, required: true, index: true },
    pinned: { type: Boolean, default: false, index: true },

    startedPlayingAt: { type: Date },
    skippedAt: { type: Date, index: true },
    skippedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    skippedReason: { type: String },

    removedAt: { type: Date },
    removedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    removalReason: { type: String },

    autoRejectedAt: { type: Date, index: true },
  },
  { timestamps: true },
);

SongSchema.index({ eventId: 1, status: 1, sortKey: 1 });
SongSchema.index({ eventId: 1, status: 1, voteScore: -1, createdAt: 1 });

const SongModel = model('Song', SongSchema, 'songs');

module.exports = {
  SongModel,
};
