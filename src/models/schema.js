const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

const emailLower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const upperTrim = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

const stripPrivate = (_doc, ret) => {
  delete ret.passwordHash;
  delete ret.__v;
  return ret;
};

const ALL_EVENT_PERMISSIONS = [
  'QUEUE_READ',
  'QUEUE_EDIT',
  'SONG_SUGGEST',
  'SONG_VOTE',
  'SONG_APPROVE_REJECT',
  'PARTICIPANT_KICK',
  'PARTICIPANT_BAN',
  'EVENT_START',
  'EVENT_END',
  'EVENT_CANCEL',
  'EVENT_SETTINGS_EDIT',
  'ANALYTICS_READ',
];

function defaultPermissionsForRole(role) {
  switch (role) {
    case 'DJ':
      return [
        'QUEUE_READ',
        'QUEUE_EDIT',
        'SONG_APPROVE_REJECT',
        'PARTICIPANT_KICK',
        'PARTICIPANT_BAN',
        'EVENT_START',
        'EVENT_END',
        'EVENT_CANCEL',
        'EVENT_SETTINGS_EDIT',
      ];
    case 'ATTENDEE':
      return ['QUEUE_READ', 'SONG_SUGGEST', 'SONG_VOTE'];
    default:
      return ['QUEUE_READ'];
  }
}

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
    role: {
      type: String,
      required: true,
      enum: ['ATTENDEE', 'DJ', 'ADMIN'],
      default: 'ATTENDEE',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

UserSchema.set('toJSON', { transform: stripPrivate });
UserSchema.set('toObject', { transform: stripPrivate });

const EventSettingsSchema = new Schema(
  {
    allowRequests: { type: Boolean, default: true },
    requireApproval: { type: Boolean, default: false },
    votingEnabled: { type: Boolean, default: true },
    allowDownvotes: { type: Boolean, default: true },
    maxRequestsPerParticipant: { type: Number, default: 3, min: 0 },
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

const VoteSchema = new Schema(
  {
    songId: {
      type: Schema.Types.ObjectId,
      ref: 'Song',
      required: true,
      index: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: 'Participant',
      required: true,
      index: true,
    },
    value: { type: Number, required: true, enum: [-1, 1] },
  },
  { timestamps: true },
);

VoteSchema.index({ songId: 1, participantId: 1 }, { unique: true });
VoteSchema.index({ songId: 1, createdAt: -1 });

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

const UserModel = model('User', UserSchema, 'users');
const EventModel = model('Event', EventSchema, 'events');
const EventMemberModel = model(
  'EventMember',
  EventMemberSchema,
  'event_members',
);
const ParticipantModel = model(
  'Participant',
  ParticipantSchema,
  'participants',
);
const SongModel = model('Song', SongSchema, 'songs');
const VoteModel = model('Vote', VoteSchema, 'votes');
const EventActionLogModel = model(
  'EventActionLog',
  EventActionLogSchema,
  'event_action_logs',
);

async function hasEventPermission(user, eventId, permission) {
  if (user.role === 'ADMIN') return true;
  const member = await EventMemberModel.findOne({ eventId, userId: user._id })
    .select({ permissions: 1 })
    .lean();
  if (!member) return false;
  return (
    Array.isArray(member.permissions) && member.permissions.includes(permission)
  );
}

async function connectMongo(uri, dbName) {
  mongoose.set('strictQuery', true);
  const opts = { autoIndex: true };
  if (dbName) opts.dbName = dbName;
  await mongoose.connect(uri, opts);
  return mongoose.connection;
}

module.exports = {
  UserModel,
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  VoteModel,
  EventActionLogModel,
  connectMongo,
  hasEventPermission,
  defaultPermissionsForRole,
  ALL_EVENT_PERMISSIONS,
};
