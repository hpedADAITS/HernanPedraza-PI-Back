const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const { UserModel } = require('../../src/models');

let mongoServer;
let originalDebugMode;

beforeAll(async () => {
  originalDebugMode = process.env.DEBUG_MODE;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  if (originalDebugMode === undefined) {
    delete process.env.DEBUG_MODE;
  } else {
    process.env.DEBUG_MODE = originalDebugMode;
  }

  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
});

describe('Debug mock accounts', () => {
  test('is unavailable when DEBUG_MODE is disabled', async () => {
    delete process.env.DEBUG_MODE;

    const res = await request(app).post('/api/v1/debug/mock-accounts');

    expect(res.status).toBe(404);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  test('creates verified DJ and attendee accounts in MongoDB', async () => {
    process.env.DEBUG_MODE = 'true';

    const res = await request(app)
      .post('/api/v1/debug/mock-accounts')
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.validatedAgainstMongo).toBe(true);
    expect(res.body.data.accounts).toHaveLength(2);

    const roles = res.body.data.accounts.map((account) => account.role).sort();
    expect(roles).toEqual(['ATTENDEE', 'DJ']);

    for (const account of res.body.data.accounts) {
      expect(account.email).toMatch(/@syncrekuest\.local$/);
      expect(account.password).toBe('DebugPass123!');
      expect(account.emailRegistered).toBe(true);
      expect(account.token).toEqual(expect.any(String));

      const stored = await UserModel.findOne({ email: account.email });
      expect(stored).toMatchObject({
        displayName: account.displayName,
        role: account.role,
        emailRegistered: true,
        isActive: true,
      });

      const login = await request(app).post('/api/v1/auth/login').send({
        email: account.email,
        password: account.password,
      });

      expect(login.status).toBe(200);
      expect(login.body.data.user.role).toBe(account.role);
    }
  });
});
