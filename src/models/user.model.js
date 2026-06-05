const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const emailLower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

const stripPrivate = (_doc, ret) => {
  delete ret.passwordHash;
  delete ret.__v;
  return ret;
};

const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      set: emailLower,
    },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true },
    profilePicture: { type: String, default: null },
    role: {
      type: String,
      required: true,
      enum: ['ATTENDEE', 'DJ'],
      default: 'ATTENDEE',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date },
    emailRegistered: { type: Boolean, default: false, index: true },
    emailRegisteredAt: { type: Date, default: null },
    emailVerificationAttempts: { type: Number, default: 0 },
    emailVerificationLastSentAt: { type: Date, default: null },
    emailVerificationTokenId: { type: String, default: null, index: true },
    authTokenVersion: { type: Number, default: 0 },
    hasSeenTutorial: { type: Boolean, default: false },
  },
  { timestamps: true },
);

UserSchema.set('toJSON', { transform: stripPrivate });
UserSchema.set('toObject', { transform: stripPrivate });

const UserModel = model('User', UserSchema, 'users');

module.exports = {
  UserModel,
};
