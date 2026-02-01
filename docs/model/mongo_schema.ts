import mongoose, { Schema, model, Types } from "mongoose";

export type UserRole = "ATTENDEE" | "DJ" | "ADMIN";

export type EventState = "DRAFT" | "LIVE" | "ENDED" | "CANCELLED";

export type EventMemberRole = "OWNER" | "DJ" | "MODERATOR";

export type EventPermission =
  | "QUEUE_READ"
  | "QUEUE_EDIT"
  | "SONG_APPROVE_REJECT"
  | "PARTICIPANT_KICK"
  | "PARTICIPANT_BAN"
  | "EVENT_START"
  | "EVENT_END"
  | "EVENT_CANCEL"
  | "EVENT_SETTINGS_EDIT"
  | "ANALYTICS_READ";

export type SongStatus = "PENDING" | "APPROVED" | "PLAYING" | "PLAYED" | "SKIPPED" | "REJECTED";

export type EventActionType =
  | "EVENT_START"
  | "EVENT_END"
  | "EVENT_CANCEL"
  | "PARTICIPANT_KICK"
  | "PARTICIPANT_BAN"
  | "PARTICIPANT_UNBAN"
  | "PARTICIPANT_COOLDOWN"
  | "SONG_APPROVE"
  | "SONG_REJECT"
  | "SONG_REMOVE"
  | "SONG_REORDER"
  | "SONG_SKIP"
  | "SONG_STATUS_CHANGE"
  | "SETTINGS_CHANGE";

const emailLower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);
const upperTrim = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);

const stripPrivate = (_doc: any, ret: any) => {
  delete ret.passwordHash;
  delete ret.__v;
  return ret;
};

export const ALL_EVENT_PERMISSIONS: Readonly<EventPermission[]> = [
  "QUEUE_READ",
  "QUEUE_EDIT",
  "SONG_APPROVE_REJECT",
  "PARTICIPANT_KICK",
  "PARTICIPANT_BAN",
  "EVENT_START",
  "EVENT_END",
  "EVENT_CANCEL",
  "EVENT_SETTINGS_EDIT",
  "ANALYTICS_READ",
];

export function defaultPermissionsForRole(role: EventMemberRole): EventPermission[] {
  switch (role) {
    case "OWNER":
      return [...ALL_EVENT_PERMISSIONS];
    case "DJ":
      return [
        "QUEUE_READ",
        "QUEUE_EDIT",
        "SONG_APPROVE_REJECT",
        "PARTICIPANT_KICK",
        "PARTICIPANT_BAN",
        "EVENT_START",
        "EVENT_END",
        "EVENT_CANCEL",
        "EVENT_SETTINGS_EDIT",
      ];
    case "MODERATOR":
      return ["QUEUE_READ", "SONG_APPROVE_REJECT", "PARTICIPANT_KICK", "PARTICIPANT_BAN"];
    default:
      return ["QUEUE_READ"];
  }
}



export interface IUser {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, index: true, set: emailLower },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: ["ATTENDEE", "DJ", "ADMIN"], default: "ATTENDEE", index: true },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

UserSchema.set("toJSON", { transform: stripPrivate });
UserSchema.set("toObject", { transform: stripPrivate });



export interface IEventSettings {
  allowRequests: boolean;
  requireApproval: boolean;
  votingEnabled: boolean;
  allowDownvotes: boolean;
  maxRequestsPerParticipant: number;
}

const EventSettingsSchema = new Schema<IEventSettings>(
  {
    allowRequests: { type: Boolean, default: true },
    requireApproval: { type: Boolean, default: false },
    votingEnabled: { type: Boolean, default: true },
    allowDownvotes: { type: Boolean, default: true },
    maxRequestsPerParticipant: { type: Number, default: 3, min: 0 },
  },
  { _id: false }
);

export interface IEvent {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  ownerId: Types.ObjectId; 
  accessCode: string; 
  qrCodeUrl?: string;
  state: EventState;

  startsAt: Date;
  endedAt?: Date;
  cancelledAt?: Date;
  cancelledReason?: string;

  currentSongId?: Types.ObjectId; 

  settings: IEventSettings;

  createdAt: Date;
  updatedAt: Date;
}

const EventSchema = new Schema<IEvent>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },

    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    accessCode: { type: String, required: true, unique: true, index: true, set: upperTrim },
    qrCodeUrl: { type: String },

    state: {
      type: String,
      required: true,
      enum: ["DRAFT", "LIVE", "ENDED", "CANCELLED"],
      default: "DRAFT",
      index: true,
    },

    startsAt: { type: Date, required: true, index: true },
    endedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledReason: { type: String },

    currentSongId: { type: Schema.Types.ObjectId, ref: "Song" },

    settings: { type: EventSettingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

EventSchema.index({ ownerId: 1, startsAt: -1 });
EventSchema.index({ state: 1, startsAt: -1 });
EventSchema.index({ accessCode: 1 }, { unique: true });

export interface IEventMember {
  _id: Types.ObjectId;
  eventId: Types.ObjectId; 
  userId: Types.ObjectId; 
  role: EventMemberRole;
  permissions: EventPermission[];
  addedBy: Types.ObjectId; 
  createdAt: Date;
  updatedAt: Date;
}

const EventMemberSchema = new Schema<IEventMember>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    role: { type: String, required: true, enum: ["OWNER", "DJ", "MODERATOR"], index: true },

    permissions: {
      type: [String],
      required: true,
      enum: ALL_EVENT_PERMISSIONS,
      default: ["QUEUE_READ"],
    },

    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

EventMemberSchema.index({ eventId: 1, userId: 1 }, { unique: true });
EventMemberSchema.index({ eventId: 1, role: 1 });

export interface IParticipant {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;

  nickname: string;
  nicknameLower: string;

  socketId?: string;

  joinedAt: Date;
  lastSeenAt: Date;

  isBanned: boolean;

  kickedAt?: Date;
  kickedBy?: Types.ObjectId; 
  kickReason?: string;

  bannedAt?: Date;
  bannedBy?: Types.ObjectId; 
  banReason?: string;

  // Cooldown system (replaces kick/ban)
  cooldownUntil?: Date;
  cooldownReason?: string;

  // Premium participant (priority queue)
  isPremium?: boolean;

  leftAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const ParticipantSchema = new Schema<IParticipant>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },

    nickname: { type: String, required: true, trim: true },
    nicknameLower: { type: String, required: true, trim: true, index: true },

    socketId: { type: String, index: true },

    joinedAt: { type: Date, default: () => new Date(), index: true },
    lastSeenAt: { type: Date, default: () => new Date(), index: true },

    isBanned: { type: Boolean, default: false, index: true },

    kickedAt: { type: Date },
    kickedBy: { type: Schema.Types.ObjectId, ref: "User" },
    kickReason: { type: String },

    bannedAt: { type: Date },
    bannedBy: { type: Schema.Types.ObjectId, ref: "User" },
    banReason: { type: String },

    cooldownUntil: { type: Date, index: true },
    cooldownReason: { type: String },

    isPremium: { type: Boolean, default: false, index: true },

    leftAt: { type: Date },
  },
  { timestamps: true }
);

ParticipantSchema.pre("validate", function (next) {
  if (this.nickname) this.nicknameLower = this.nickname.trim().toLowerCase();
  next();
});


ParticipantSchema.index({ eventId: 1, nicknameLower: 1 }, { unique: true });

ParticipantSchema.index({ eventId: 1, socketId: 1 }, { unique: true, sparse: true });



export interface ISong {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;

  title: string;
  artist: string;

  requestedBy: Types.ObjectId; 
  status: SongStatus;

  voteScore: number;
  voteCount: number;

  // Queue positioning
  queuePosition?: number;
  
  sortKey: string;
  pinned: boolean;

  // Playback tracking
  startedPlayingAt?: Date;
  skippedAt?: Date;
  skippedBy?: Types.ObjectId;
  skippedReason?: string;

  removedAt?: Date;
  removedBy?: Types.ObjectId; 
  removalReason?: string;

  // Auto-rejection for old pending songs
  autoRejectedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const SongSchema = new Schema<ISong>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },

    title: { type: String, required: true, trim: true },
    artist: { type: String, required: true, trim: true },

    requestedBy: { type: Schema.Types.ObjectId, ref: "Participant", required: true, index: true },

    status: {
      type: String,
      required: true,
      enum: ["PENDING", "APPROVED", "PLAYING", "PLAYED", "SKIPPED", "REJECTED"],
      default: "PENDING",
      index: true,
    },

    voteScore: { type: Number, default: 0, index: true },
    voteCount: { type: Number, default: 0 },

    queuePosition: { type: Number, index: true },
    
    sortKey: { type: String, required: true, index: true },
    pinned: { type: Boolean, default: false, index: true },

    startedPlayingAt: { type: Date },
    skippedAt: { type: Date, index: true },
    skippedBy: { type: Schema.Types.ObjectId, ref: "User" },
    skippedReason: { type: String },

    removedAt: { type: Date },
    removedBy: { type: Schema.Types.ObjectId, ref: "User" },
    removalReason: { type: String },

    autoRejectedAt: { type: Date, index: true },
  },
  { timestamps: true }
);


SongSchema.index({ eventId: 1, status: 1, sortKey: 1 });

SongSchema.index({ eventId: 1, status: 1, voteScore: -1, createdAt: 1 });



export interface IVote {
  _id: Types.ObjectId;
  songId: Types.ObjectId; 
  participantId: Types.ObjectId; 
  value: -1 | 1;
  createdAt: Date;
  updatedAt: Date;
}

const VoteSchema = new Schema<IVote>(
  {
    songId: { type: Schema.Types.ObjectId, ref: "Song", required: true, index: true },
    participantId: { type: Schema.Types.ObjectId, ref: "Participant", required: true, index: true },
    value: { type: Number, required: true, enum: [-1, 1] },
  },
  { timestamps: true }
);

VoteSchema.index({ songId: 1, participantId: 1 }, { unique: true });
VoteSchema.index({ songId: 1, createdAt: -1 });

export interface IEventActionLog {
  _id: Types.ObjectId;
  eventId: Types.ObjectId; 
  actorUserId: Types.ObjectId; 
  type: EventActionType;

  participantId?: Types.ObjectId; 
  songId?: Types.ObjectId; 

  meta?: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

const EventActionLogSchema = new Schema<IEventActionLog>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: [
         "EVENT_START",
         "EVENT_END",
         "EVENT_CANCEL",
         "PARTICIPANT_KICK",
         "PARTICIPANT_BAN",
         "PARTICIPANT_UNBAN",
         "PARTICIPANT_COOLDOWN",
         "SONG_APPROVE",
         "SONG_REJECT",
         "SONG_REMOVE",
         "SONG_REORDER",
         "SONG_SKIP",
         "SONG_STATUS_CHANGE",
         "SETTINGS_CHANGE",
       ],
      index: true,
    },
    participantId: { type: Schema.Types.ObjectId, ref: "Participant", index: true },
    songId: { type: Schema.Types.ObjectId, ref: "Song", index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

EventActionLogSchema.index({ eventId: 1, createdAt: -1 });

export const UserModel = model<IUser>("User", UserSchema, "users");
export const EventModel = model<IEvent>("Event", EventSchema, "events");
export const EventMemberModel = model<IEventMember>("EventMember", EventMemberSchema, "event_members");
export const ParticipantModel = model<IParticipant>("Participant", ParticipantSchema, "participants");
export const SongModel = model<ISong>("Song", SongSchema, "songs");
export const VoteModel = model<IVote>("Vote", VoteSchema, "votes");
export const EventActionLogModel = model<IEventActionLog>("EventActionLog", EventActionLogSchema, "event_action_logs");

export async function hasEventPermission(
  user: Pick<IUser, "_id" | "role">,
  eventId: Types.ObjectId,
  permission: EventPermission
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  const member = await EventMemberModel.findOne({ eventId, userId: user._id }).select({ permissions: 1 }).lean();
  if (!member) return false;
  return Array.isArray(member.permissions) && member.permissions.includes(permission);
}

export async function connectMongo(uri: string) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { autoIndex: true });
  return mongoose.connection;
}
