const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app');
const {
  EventMemberModel,
  EventModel,
  ParticipantModel,
  UserModel,
} = require('../../src/models');

let mongoServer;
let originalDebugMode;
let originalNodeEnv;

beforeAll(async () => {
  originalDebugMode = process.env.DEBUG_MODE;
  originalNodeEnv = process.env.NODE_ENV;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  if (originalDebugMode === undefined) {
    delete process.env.DEBUG_MODE;
  } else {
    process.env.DEBUG_MODE = originalDebugMode;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await EventMemberModel.deleteMany({});
  await ParticipantModel.deleteMany({});
  await EventModel.deleteMany({});
  await UserModel.deleteMany({});
});

describe('Debug mock accounts', () => {
  test('is unavailable when DEBUG_MODE is disabled', async () => {
    delete process.env.DEBUG_MODE;
    process.env.NODE_ENV = 'test';

    const res = await request(app).post('/api/v1/debug/mock-accounts');

    expect(res.status).toBe(404);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  test('is unavailable in production even when DEBUG_MODE is enabled', async () => {
    process.env.DEBUG_MODE = 'true';
    process.env.NODE_ENV = 'production';

    const res = await request(app).post('/api/v1/debug/mock-accounts');

    expect(res.status).toBe(404);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  test('creates verified DJ and attendee accounts in MongoDB', async () => {
    process.env.DEBUG_MODE = 'true';
    process.env.NODE_ENV = 'test';

    const res = await request(app)
      .post('/api/v1/debug/mock-accounts')
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.validatedAgainstMongo).toBe(true);
    expect(res.body.data.accounts).toHaveLength(2);
    expect(res.body.data.event).toMatchObject({
      accessCode: 'DEBUG1',
      eventId: 'DEBUGEVT',
      name: 'Debug Event',
      state: 'LIVE',
      ownerName: 'Debug DJ',
    });
    expect(res.body.data.attendeeLogin).toMatchObject({
      nickname: 'Debug_Attendee',
      accessCode: res.body.data.event.accessCode,
      password: 'DebugPass123!',
      participantId: expect.any(String),
    });
    expect(res.body.data.attendeeLogin.nickname.length).toBeLessThanOrEqual(30);

    const roles = res.body.data.accounts.map((account) => account.role).sort();
    expect(roles).toEqual(['ATTENDEE', 'DJ']);
    let attendeeLoginToken;

    for (const account of res.body.data.accounts) {
      expect(account.email).toMatch(/@Syncrequest\.local$/);
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
      if (account.role === 'ATTENDEE') {
        attendeeLoginToken = login.body.data.token;
      }
    }

    const event = await EventModel.findOne({
      accessCode: res.body.data.event.accessCode,
    });
    expect(event.state).toBe('LIVE');

    const participant = await ParticipantModel.findById(
      res.body.data.attendeeLogin.participantId,
    ).select('+passwordHash');
    expect(participant).toMatchObject({
      nickname: res.body.data.attendeeLogin.nickname,
      eventId: event._id,
    });

    const join = await request(app)
      .post(`/api/v1/participants/${event._id}/join`)
      .set('Authorization', `Bearer ${attendeeLoginToken}`)
      .send({
        nickname: res.body.data.attendeeLogin.nickname,
        password: res.body.data.attendeeLogin.password,
      });

    expect(join.status).toBe(201);
    expect(join.body.data.participant._id).toBe(
      res.body.data.attendeeLogin.participantId,
    );
  });

  test('reuses stable debug accounts and event across repeated calls', async () => {
    process.env.DEBUG_MODE = 'true';
    process.env.NODE_ENV = 'test';

    const first = await request(app)
      .post('/api/v1/debug/mock-accounts')
      .expect(201);
    const second = await request(app)
      .post('/api/v1/debug/mock-accounts')
      .expect(201);

    const stableFields = (data) => ({
      event: data.event,
      attendeeLogin: data.attendeeLogin,
      accounts: data.accounts.map(
        ({ email, password, displayName, role, emailRegistered }) => ({
          email,
          password,
          displayName,
          role,
          emailRegistered,
        }),
      ),
    });

    expect(stableFields(second.body.data)).toEqual(
      stableFields(first.body.data),
    );
    expect(await UserModel.countDocuments()).toBe(2);
    expect(await EventModel.countDocuments()).toBe(1);
    expect(await EventMemberModel.countDocuments()).toBe(1);
    expect(await ParticipantModel.countDocuments()).toBe(1);
  });
});
