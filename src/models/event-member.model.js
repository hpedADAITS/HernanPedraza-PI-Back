const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const { ALL_EVENT_PERMISSIONS } = require('./shared');

const EventMemberSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    role: {
      type: String,
      required: true,
      enum: ['DJ', 'ATTENDEE'],
      index: true,
    },

    permissions: {
      type: [String],
      required: true,
      enum: ALL_EVENT_PERMISSIONS,
      default: ['QUEUE_READ'],
    },

    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

EventMemberSchema.index({ eventId: 1, userId: 1 }, { unique: true });
EventMemberSchema.index({ eventId: 1, role: 1 });

const EventMemberModel = model('EventMember', EventMemberSchema, 'event_members');

module.exports = {
  EventMemberModel,
};
