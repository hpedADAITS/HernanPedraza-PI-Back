const bcrypt = require('bcryptjs');
const { UserModel } = require('../models');
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

    return {
      createdAt: new Date().toISOString(),
      validatedAgainstMongo: true,
      accounts: users.map(accountResponse),
    };
  }
}

module.exports = new DebugService();
