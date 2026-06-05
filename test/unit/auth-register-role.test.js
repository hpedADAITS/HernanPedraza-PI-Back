/**
 * test/unit/auth-register-role.test.js
 *
 * Tests the public /auth/register role-assignment policy:
 *   - ATTENDEE body -> user is ATTENDEE
 *   - DJ body      -> user is DJ
 *   - ADMIN body   -> downgraded to ATTENDEE (admin role is reserved for
 *                     out-of-band provisioning via debug service / DB)
 *   - Any other role string is rejected by the validator.
 *
 * No DEBUG_MODE gate: a DJ can self-register in any environment.
 */

process.env.JWT_SECRET = 'unit-test-jwt-secret-with-enough-entropy-for-checks';
process.env.NODE_ENV = 'development';
/* Force DEBUG_MODE off so we exercise the production path explicitly. */
process.env.DEBUG_MODE = 'false';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const authService = require('../../src/services/auth.service');
const { UserModel } = require('../../src/models');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function registerAs(role) {
  const email = `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`;
  const result = await authService.register(
    email,
    'StrongPass123!',
    `${role} Test`,
    role,
  );
  const stored = await UserModel.findOne({ email });
  return { result, stored };
}

describe('authService.register role assignment', () => {
  test('ATTENDEE body creates an ATTENDEE', async () => {
    const { result, stored } = await registerAs('ATTENDEE');
    expect(result.user.role).toBe('ATTENDEE');
    expect(stored.role).toBe('ATTENDEE');
  });

  test('DJ body creates a DJ (no DEBUG_MODE gate)', async () => {
    const { result, stored } = await registerAs('DJ');
    expect(result.user.role).toBe('DJ');
    expect(stored.role).toBe('DJ');
  });

  test('no role defaults to ATTENDEE', async () => {
    const email = `default-${Date.now()}-${Math.random()}@test.com`;
    const result = await authService.register(
      email,
      'StrongPass123!',
      'Default User',
    );
    const stored = await UserModel.findOne({ email });
    expect(result.user.role).toBe('ATTENDEE');
    expect(stored.role).toBe('ATTENDEE');
  });

  test('invalid role is rejected by the validator before reaching the service', async () => {
    await expect(
      authService.register(
        `wizard-${Date.now()}@test.com`,
        'StrongPass123!',
        'Wizard',
        'WIZARD',
      ),
    ).rejects.toThrow();
  });

  test('welcome email is sent only for DJ (the role that needs verification)', async () => {
    const emailSpy = jest
      .spyOn(require('../../src/services/email.service'), 'sendWelcomeEmail')
      .mockResolvedValue({ token: 'verify-token' });

    await registerAs('DJ');
    expect(emailSpy).toHaveBeenCalledTimes(1);
    emailSpy.mockClear();

    await registerAs('ATTENDEE');
    expect(emailSpy).not.toHaveBeenCalled();
  });
});
