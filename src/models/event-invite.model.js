const mongoose = require('mongoose');

const { Schema, model } = mongoose;

/* A friend-to-friend invitation to a specific DJ event, delivered by email
   to the invitee. The event can be either the inviter's current event or
   any event whose access code the inviter has chosen to share. */
const EventInviteSchema = new Schema(
  {
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /* Stored on the invite so the email can be regenerated/forwarded
       without a User lookup. The front never displays this. */
    toEmail: { type: String, required: true },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
    },
    eventName: { type: String, default: null, trim: true },
    /* The access code is required so the recipient can join. */
    eventCode: { type: String, required: true, trim: true },
    message: { type: String, default: null, maxlength: 200 },
    status: {
      type: String,
      enum: ['sent', 'accepted', 'dismissed', 'expired'],
      default: 'sent',
      index: true,
    },
    sentAt: { type: Date, default: () => new Date(), index: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

EventInviteSchema.index({ toUserId: 1, status: 1, sentAt: -1 });
EventInviteSchema.index({ fromUserId: 1, sentAt: -1 });

const EventInviteModel = model('EventInvite', EventInviteSchema, 'event_invites');

module.exports = { EventInviteModel };
