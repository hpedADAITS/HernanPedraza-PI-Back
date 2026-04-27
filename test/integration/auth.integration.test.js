const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { UserModel } = require('../../src/models');

let mongoServer;

const VALID_USER = {
  email: 'dj.flow@example.com',
  password: 'StrongPass123!',
  displayName: 'DJ Flow',
  role: 'DJ',
};

const registerUser = (overrides = {}) =>
  request(app)
    .post('/api/v1/auth/register')
    .send({ ...VALID_USER, ...overrides });

const loginUser = (creds) =>
  request(app).post('/api/v1/auth/login').send(creds);

const refresh = (token) =>
  request(app).post('/api/v1/auth/refresh').send({ token });

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
});

describe('Auth Flows Integration', () => {
  describe('POST /api/v1/auth/register', () => {
    test('registers a new user and returns token + user data', async () => {
      const res = await registerUser().expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.user).toMatchObject({
        email: VALID_USER.email.toLowerCase(),
        displayName: VALID_USER.displayName,
        role: VALID_USER.role,
      });

      const stored = await UserModel.findOne({
        email: VALID_USER.email.toLowerCase(),
      }).select('+passwordHash');
      expect(stored).toBeTruthy();
      expect(stored.passwordHash).not.toBe(VALID_USER.password);
    });

    test('rejects duplicate email with 400', async () => {
      await registerUser().expect(201);
      const res = await registerUser({ displayName: 'Other' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('rejects invalid email format', async () => {
      const res = await registerUser({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    test('rejects short password', async () => {
      const res = await registerUser({ password: 'short' });
      expect(res.status).toBe(400);
    });

    test('rejects missing displayName', async () => {
      const res = await registerUser({ displayName: '' });
      expect(res.status).toBe(400);
    });

    test('rejects invalid role', async () => {
      const res = await registerUser({ role: 'WIZARD' });
      expect(res.status).toBe(400);
    });

    test('issued token contains userId, email, role and is verifiable', async () => {
      const res = await registerUser().expect(201);
      const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
      expect(decoded.email).toBe(VALID_USER.email.toLowerCase());
      expect(decoded.role).toBe(VALID_USER.role);
      expect(decoded.userId).toEqual(expect.any(String));
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await registerUser();
    });

    test('logs in with correct credentials', async () => {
      const res = await loginUser({
        email: VALID_USER.email,
        password: VALID_USER.password,
      }).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.user.email).toBe(VALID_USER.email.toLowerCase());
    });

    test('login is case-insensitive on email', async () => {
      const res = await loginUser({
        email: VALID_USER.email.toUpperCase(),
        password: VALID_USER.password,
      });
      expect(res.status).toBe(200);
    });

    test('updates lastLoginAt on success', async () => {
      const before = await UserModel.findOne({ email: VALID_USER.email });
      expect(before.lastLoginAt).toBeFalsy();

      await loginUser({
        email: VALID_USER.email,
        password: VALID_USER.password,
      }).expect(200);

      const after = await UserModel.findOne({ email: VALID_USER.email });
      expect(after.lastLoginAt).toBeInstanceOf(Date);
    });

    test('rejects wrong password with 401', async () => {
      const res = await loginUser({
        email: VALID_USER.email,
        password: 'WrongPass999!',
      });
      expect(res.status).toBe(401);
    });

    test('rejects unknown email with 401 (no enumeration leak)', async () => {
      const res = await loginUser({
        email: 'nobody@example.com',
        password: VALID_USER.password,
      });
      expect(res.status).toBe(401);
    });

    test('rejects missing fields with 400', async () => {
      const res = await loginUser({ email: VALID_USER.email });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let token;

    beforeEach(async () => {
      const res = await registerUser();
      token = res.body.data.token;
    });

    test('issues a new token from a valid token', async () => {
      const res = await refresh(token).expect(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
      expect(decoded.email).toBe(VALID_USER.email.toLowerCase());
    });

    test('rejects missing token with 400', async () => {
      const res = await refresh(undefined);
      expect(res.status).toBe(400);
    });

    test('rejects malformed token with 401', async () => {
      const res = await refresh('not.a.real.token');
      expect(res.status).toBe(401);
    });

    test('rejects token signed with different secret', async () => {
      const bad = jwt.sign({ userId: 'x' }, 'other-secret');
      const res = await refresh(bad);
      expect(res.status).toBe(401);
    });

    test('rejects expired token with 401', async () => {
      const expired = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' },
      );
      const res = await refresh(expired);
      expect(res.status).toBe(401);
    });

    test('returns 404 when user no longer exists', async () => {
      await UserModel.deleteMany({});
      const res = await refresh(token);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let token;

    beforeEach(async () => {
      const res = await registerUser();
      token = res.body.data.token;
    });

    test('returns current user with valid bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.user.email).toBe(VALID_USER.email.toLowerCase());
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    test('rejects missing Authorization header with 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    test('rejects invalid token with 401', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer garbage');
      expect(res.status).toBe(401);
    });
  });

  describe('Full register -> login -> refresh -> me chain', () => {
    test('completes happy path end-to-end', async () => {
      const reg = await registerUser().expect(201);
      expect(reg.body.data.token).toBeTruthy();

      const login = await loginUser({
        email: VALID_USER.email,
        password: VALID_USER.password,
      }).expect(200);
      const loginToken = login.body.data.token;

      const refreshed = await refresh(loginToken).expect(200);
      const newToken = refreshed.body.data.token;
      expect(newToken).toEqual(expect.any(String));

      const me = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);
      expect(me.body.data.user.email).toBe(VALID_USER.email.toLowerCase());
    });
  });
});
