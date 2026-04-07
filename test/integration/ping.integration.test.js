const request = require('supertest');
const app = require('../../src/app');

describe('Ping Routes Integration Tests', () => {
  describe('GET /api/v1/ping', () => {
    test('should return 200 and success message', async () => {
      const response = await request(app)
        .get('/api/v1/ping')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });

    test('should return message in Spanish', async () => {
      const response = await request(app)
        .get('/api/v1/ping');

      expect(response.body.message).toMatch(/SyncRekuest/i);
    });

    test('should return valid ISO timestamp', async () => {
      const response = await request(app)
        .get('/api/v1/ping');

      expect(response.body.timestamp).toBeDefined();
      expect(() => new Date(response.body.timestamp)).not.toThrow();
    });
  });

  describe('GET /api/v1/ping/health', () => {
    test('should return health check status', async () => {
      const response = await request(app)
        .get('/api/v1/ping/health');

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('api');
      expect(response.body).toHaveProperty('database');
    });

    test('should return api as true', async () => {
      const response = await request(app)
        .get('/api/v1/ping/health');

      expect(response.body.api).toBe(true);
    });

    test('should return timestamp', async () => {
      const response = await request(app)
        .get('/api/v1/ping/health');

      expect(response.body).toHaveProperty('timestamp');
      expect(() => new Date(response.body.timestamp)).not.toThrow();
    });
  });

  describe('Root health check', () => {
    test('GET / should return status ok', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('environment');
    });

    test('HEAD / should return 200', async () => {
      await request(app)
        .head('/')
        .expect(200);
    });
  });
});
