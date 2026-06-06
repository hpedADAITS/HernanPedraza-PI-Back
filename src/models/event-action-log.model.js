const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const EventActionLogSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'EVENT_START',
        'EVENT_END',
        'EVENT_CANCEL',
        'PARTICIPANT_KICK',
        'PARTICIPANT_BAN',
        'PARTICIPANT_UNBAN',
        'PARTICIPANT_COOLDOWN',
        'SONG_APPROVE',
        'SONG_REJECT',
        'SONG_REMOVE',
        'SONG_REORDER',
        'SONG_SKIP',
        'SONG_STATUS_CHANGE',
        'SETTINGS_CHANGE',
      ],
      index: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: 'Participant',
      index: true,
    },
    songId: { type: Schema.Types.ObjectId, ref: 'Song', index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

EventActionLogSchema.index({ eventId: 1, createdAt: -1 });

const EventActionLogModel = model(
  'EventActionLog',
  EventActionLogSchema,
  'event_action_logs',
);

module.exports = {
  EventActionLogModel,
};
