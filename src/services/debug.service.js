const bcrypt = require('bcryptjs');
const {
  EventMemberModel,
  EventModel,
  ParticipantModel,
  UserModel,
  defaultPermissionsForRole,
} = require('../models');
const { generateEventCode } = require('../utils/code-generator');
const { generateToken } = require('../utils/jwt.utils');

const DEBUG_PASSWORD = 'DebugPass123!';

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

function buildAttendeeNickname(suffix) {
  return `Debug_Attendee_${suffix.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(
    0,
    30,
  );
}

class DebugService {
  async createMockAccounts() {
    const suffix = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const passwordHash = await bcrypt.hash(DEBUG_PASSWORD, 10);

    const users = await UserModel.insertMany(
      DEBUG_ACCOUNT_TYPES.map((account) => ({
        email: `${account.emailPrefix}.${suffix}@syncrekuest.local`,
        passwordHash,
        displayName: `${account.displayName} ${suffix}`,
        role: account.role,
        emailRegistered: true,
        emailRegisteredAt: new Date(),
        isActive: true,
      })),
    );
    const dj = users.find((user) => user.role === 'DJ');
    const attendee = users.find((user) => user.role === 'ATTENDEE');
    if (!dj || !attendee) {
      throw new Error('Debug account creation failed');
    }

    const event = await this._createMockEvent(dj, suffix);
    const participant = await this._createMockParticipant(
      event,
      attendee,
      passwordHash,
      buildAttendeeNickname(suffix),
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

  async _createMockEvent(dj, suffix) {
    const event = new EventModel({
      name: `Debug Event ${suffix}`,
      description: 'Generated from the debug account tool',
      ownerId: dj._id,
      eventId: generateEventCode(8),
      accessCode: generateEventCode(6),
      state: 'LIVE',
      startsAt: new Date(),
      settings: {
        allowRequests: true,
        requireApproval: false,
        votingEnabled: true,
        allowDownvotes: true,
        maxRequestsPerParticipant: 3,
      },
    });

    await event.save();
    await EventMemberModel.create({
      eventId: event._id,
      userId: dj._id,
      role: 'DJ',
      permissions: defaultPermissionsForRole('DJ'),
      addedBy: dj._id,
    });

    return event;
  }

  async _createMockParticipant(event, attendee, passwordHash, nickname) {
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
}

module.exports = new DebugService();
