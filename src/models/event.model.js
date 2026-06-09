const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const upperTrim = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

const EventSettingsSchema = new Schema(
  {
    allowRequests: { type: Boolean, default: true },
    requireApproval: { type: Boolean, default: false },
    votingEnabled: { type: Boolean, default: true },
    allowDownvotes: { type: Boolean, default: true },
    premiumVotesEnabled: { type: Boolean, default: true },
    maxRequestsPerParticipant: { type: Number, default: 3, min: 0 },
    approveLadderThreshold: { type: Number, default: 3 },
  },
  { _id: false },
);

const EventSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },

    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      set: upperTrim,
    },

    accessCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      set: upperTrim,
    },
    qrCodeUrl: { type: String },

    state: {
      type: String,
      required: true,
      enum: ['DRAFT', 'LIVE', 'ENDED', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },

    startsAt: { type: Date, required: true, index: true },
    endedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledReason: { type: String },

    currentSongId: { type: Schema.Types.ObjectId, ref: 'Song' },

    settings: { type: EventSettingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

EventSchema.index({ ownerId: 1, startsAt: -1 });
EventSchema.index({ state: 1, startsAt: -1 });

const EventModel = model('Event', EventSchema, 'events');

module.exports = {
  EventModel,
};
