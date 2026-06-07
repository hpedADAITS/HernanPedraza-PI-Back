const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const ParticipantSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },

    nickname: { type: String, required: true, trim: true },
    nicknameLower: { type: String, required: true, trim: true, index: true },
    profilePicture: { type: String, default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    passwordHash: { type: String, select: false },
    passwordSetAt: { type: Date },

    socketId: { type: String, index: true },

    joinedAt: { type: Date, default: () => new Date(), index: true },
    lastSeenAt: { type: Date, default: () => new Date(), index: true },

    isBanned: { type: Boolean, default: false, index: true },

    kickedAt: { type: Date },
    kickedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    kickReason: { type: String },

    bannedAt: { type: Date },
    bannedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    banReason: { type: String },

    cooldownUntil: { type: Date, index: true },
    cooldownReason: { type: String },

    isPremium: { type: Boolean, default: false, index: true },

    // Track how many songs this participant has had approved
    approvalCount: { type: Number, default: 0 },

    /* Privacy / social-pref state. When `showDisplayName` is false the
       participant's public nickname becomes "Participant <anonymousNumber>"
       and `nickname` reflects that mask; the original value is preserved in
       `realNickname` so toggling the pref back on restores it. The same
       pattern is used for `showProfilePicture` / `realProfilePicture`. */
    anonymousNumber: { type: Number, default: null, index: true },
    realNickname: { type: String, default: null },
    realProfilePicture: { type: String, default: null },
    socialPrefs: {
      showDisplayName: { type: Boolean, default: true },
      showProfilePicture: { type: Boolean, default: true },
      allowFriendRequests: { type: Boolean, default: true },
    },

    leftAt: { type: Date },
  },
  { timestamps: true },
);

ParticipantSchema.pre('validate', function (next) {
  if (this.nickname) this.nicknameLower = this.nickname.trim().toLowerCase();
  next();
});

ParticipantSchema.index({ eventId: 1, nicknameLower: 1 }, { unique: true });
ParticipantSchema.index({ eventId: 1, socketId: 1 }, { sparse: true });

const ParticipantModel = model('Participant', ParticipantSchema, 'participants');

module.exports = {
  ParticipantModel,
};
