const bcrypt = require('bcryptjs');
const {
  AudioFingerprintPointModel,
  AudioTrackModel,
  EventMemberModel,
  EventModel,
  ParticipantModel,
  UserModel,
  defaultPermissionsForRole,
} = require('../models');
const { generateToken } = require('../utils/jwt.utils');

const DEBUG_PASSWORD = 'DebugPass123!';
const DEBUG_EVENT_ID = 'DEBUGEVT';
const DEBUG_ACCESS_CODE = 'DEBUG1';
const DEBUG_ATTENDEE_NICKNAME = 'Debug_Attendee';

const DEBUG_ACCOUNT_TYPES = [
  {
    role: 'DJ',
    emailPrefix: 'debug.dj',
    displayName: 'Debug DJ',
  },
  {
    role: 'ATTENDEE',
    emailPrefix: 'debug.attendee',
    displayName: 'Debug Attendee',
  },
];

function assertDebugModeAllowed() {
  if (process.env.DEBUG_MODE !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('Debug mock account creation is disabled');
  }
}

function buildDebugToken(user) {
  return generateToken({
    userId: user._id,
    email: user.email,
    role: user.role,
    type: 'default',
    tokenVersion: user.authTokenVersion || 0,
  });
}

function accountResponse(user) {
  return {
    id: user._id,
    email: user.email,
    password: DEBUG_PASSWORD,
    displayName: user.displayName,
    role: user.role,
    emailRegistered: user.emailRegistered,
    token: buildDebugToken(user),
  };
}

class DebugService {
  async getAudioFingerprintStats() {
    assertDebugModeAllowed();

    const [
      tracks,
      fingerprintedSongs,
      indexedSongs,
      fingerprintPoints,
    ] = await Promise.all([
      AudioTrackModel.countDocuments(),
      AudioTrackModel.countDocuments({
        $or: [{ pointsCount: { $gt: 0 } }, { hashesCount: { $gt: 0 } }],
      }),
      AudioTrackModel.countDocuments({ hashesCount: { $gt: 0 } }),
      AudioFingerprintPointModel.countDocuments(),
    ]);

    return {
      tracks,
      fingerprintedSongs,
      indexedSongs,
      fingerprintPoints,
      countedAt: new Date().toISOString(),
    };
  }

  async createMockAccounts() {
    assertDebugModeAllowed();

    const passwordHash = await bcrypt.hash(DEBUG_PASSWORD, 10);

    const users = await Promise.all(
      DEBUG_ACCOUNT_TYPES.map((account) =>
        this._getOrCreateDebugUser(account, passwordHash),
      ),
    );
    const dj = users.find((user) => user.role === 'DJ');
    const attendee = users.find((user) => user.role === 'ATTENDEE');
    if (!dj || !attendee) {
      throw new Error('Debug account creation failed');
    }

    const event = await this._getOrCreateMockEvent(dj);
    const participant = await this._createMockParticipant(
      event,
      attendee,
      passwordHash,
      DEBUG_ATTENDEE_NICKNAME,
    );

    const storedUsers = await UserModel.find({
      _id: { $in: users.map((user) => user._id) },
    }).select('+passwordHash');

    const storedByEmail = new Map(
      storedUsers.map((user) => [user.email, user]),
    );

    for (const user of users) {
      const stored = storedByEmail.get(user.email);
      if (
        !stored ||
        stored.role !== user.role ||
        !stored.emailRegistered ||
        !(await bcrypt.compare(DEBUG_PASSWORD, stored.passwordHash))
      ) {
        throw new Error('Debug account MongoDB validation failed');
      }
    }

    const storedEvent = await EventModel.findById(event._id);
    const storedMember = await EventMemberModel.findOne({
      eventId: event._id,
      userId: dj._id,
      role: 'DJ',
    });
    const storedParticipant = await ParticipantModel.findById(
      participant._id,
    ).select('+passwordHash');

    if (
      !storedEvent ||
      storedEvent.state !== 'LIVE' ||
      !storedMember ||
      !storedParticipant ||
      storedParticipant.userId.toString() !== attendee._id.toString() ||
      !(await bcrypt.compare(DEBUG_PASSWORD, storedParticipant.passwordHash))
    ) {
      throw new Error('Debug event MongoDB validation failed');
    }

    return {
      createdAt: new Date().toISOString(),
      validatedAgainstMongo: true,
      event: {
        id: event._id,
        name: event.name,
        eventId: event.eventId,
        accessCode: event.accessCode,
        state: event.state,
        ownerId: dj._id,
        ownerName: dj.displayName,
      },
      attendeeLogin: {
        nickname: participant.nickname,
        accessCode: event.accessCode,
        password: DEBUG_PASSWORD,
        participantId: participant._id,
      },
      accounts: users.map(accountResponse),
    };
  }

  async _getOrCreateDebugUser(account, passwordHash) {
    const email = `${account.emailPrefix}@syncrekuest.local`;
    let user = await UserModel.findOne({ email }).select('+passwordHash');

    if (!user) {
      return UserModel.create({
        email,
        passwordHash,
        displayName: account.displayName,
        role: account.role,
        emailRegistered: true,
        emailRegisteredAt: new Date(),
        isActive: true,
      });
    }

    user.displayName = account.displayName;
    user.role = account.role;
    user.emailRegistered = true;
    user.isActive = true;
    if (
      !user.passwordHash ||
      !(await bcrypt.compare(DEBUG_PASSWORD, user.passwordHash))
    ) {
      user.passwordHash = passwordHash;
    }
    if (!user.emailRegisteredAt) user.emailRegisteredAt = new Date();

    return user.save();
  }

  async _getOrCreateMockEvent(dj) {
    let event = await EventModel.findOne({
      $or: [{ eventId: DEBUG_EVENT_ID }, { accessCode: DEBUG_ACCESS_CODE }],
    });

    if (!event) {
      event = new EventModel({
        eventId: DEBUG_EVENT_ID,
        accessCode: DEBUG_ACCESS_CODE,
        startsAt: new Date(),
      });
    }

    event.set({
      name: 'Debug Event',
      description: 'Generated from the debug account tool',
      ownerId: dj._id,
      state: 'LIVE',
      settings: {
        allowRequests: true,
        requireApproval: false,
        votingEnabled: true,
        allowDownvotes: true,
        maxRequestsPerParticipant: 3,
      },
    });

    await event.save();
    await EventMemberModel.findOneAndUpdate(
      { eventId: event._id, userId: dj._id },
      {
        $set: {
          role: 'DJ',
          permissions: defaultPermissionsForRole('DJ'),
          addedBy: dj._id,
        },
      },
      { new: true, upsert: true },
    );

    return event;
  }

  async _createMockParticipant(event, attendee, passwordHash, nickname) {
    const participant = await ParticipantModel.findOne({
      eventId: event._id,
      nicknameLower: nickname.toLowerCase(),
    }).select('+passwordHash');

    if (!participant) {
      return ParticipantModel.create({
        eventId: event._id,
        userId: attendee._id,
        nickname,
        nicknameLower: nickname.toLowerCase(),
        passwordHash,
        passwordSetAt: new Date(),
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      });
    }

    participant.set({
      userId: attendee._id,
      nickname,
      isBanned: false,
      kickedAt: null,
      kickedBy: null,
      kickReason: null,
      bannedAt: null,
      bannedBy: null,
      banReason: null,
      cooldownUntil: null,
      cooldownReason: null,
      leftAt: null,
      lastSeenAt: new Date(),
    });
    if (
      !participant.passwordHash ||
      !(await bcrypt.compare(DEBUG_PASSWORD, participant.passwordHash))
    ) {
      participant.passwordHash = passwordHash;
      participant.passwordSetAt = new Date();
    }

    return participant.save();
  }
}

module.exports = new DebugService();
