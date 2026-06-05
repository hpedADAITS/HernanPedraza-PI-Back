const {
  generateToken,
  verifyToken,
  decodeToken,
} = require('../../src/utils/jwt.utils');
const config = require('../../src/config');

describe('JWT Utils', () => {
  const testUserId = '507f1f77bcf86cd799439011';
  const testEmail = 'test@example.com';
  const testRole = 'DJ';

  describe('generateToken', () => {
    test('should generate valid token from userId string', () => {
      const token = generateToken(testUserId);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    test('should generate token with user object payload', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        role: testRole,
        tokenVersion: 7,
      };
      const token = generateToken(payload);
      expect(token).toBeDefined();

      const decoded = decodeToken(token);
      expect(decoded.userId).toBe(testUserId);
      expect(decoded.email).toBe(testEmail);
      expect(decoded.role).toBe(testRole);
      expect(decoded.tokenVersion).toBe(7);
    });

    test('should preserve custom type field in payload', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload);
      expect(token).toBeDefined();

      const decoded = decodeToken(token);
      expect(decoded.type).toBe('email-verification');
      expect(decoded.userId).toBe(testUserId);
      expect(decoded.email).toBe(testEmail);
    });

    test('should generate token with custom expiry', () => {
      const customExpiry = '1h';
      const token = generateToken(testUserId, customExpiry);
      expect(token).toBeDefined();

      const decoded = decodeToken(token);
      expect(decoded.exp).toBeDefined();
    });

    test('should throw error for invalid payload', () => {
      expect(() => generateToken(null)).toThrow();
      expect(() => generateToken({})).toThrow();
      expect(() => generateToken({ email: testEmail })).toThrow();
    });

    test('should include iat (issued at) claim', () => {
      const token = generateToken(testUserId);
      const decoded = decodeToken(token);
      expect(decoded.iat).toBeDefined();
      expect(typeof decoded.iat).toBe('number');
    });
  });

  describe('verifyToken', () => {
    test('should verify valid token', () => {
      const token = generateToken(testUserId);
      const decoded = verifyToken(token);

      expect(decoded).toBeDefined();
      expect(decoded.userId).toBe(testUserId);
    });

    test('should throw error for invalid token', () => {
      expect(() => verifyToken('invalid.token.here')).toThrow();
    });

    test('should throw error for expired token', (done) => {
      /* This test would require mocking time or using an already expired token */
      /* For now, we create a minimal example */
      const expiredToken = generateToken(testUserId, '0s');

      setTimeout(() => {
        expect(() => verifyToken(expiredToken)).toThrow();
        done();
      }, 100);
    });

    test('should throw error for tampered token', () => {
      const token = generateToken(testUserId);
      const tamperedToken = token.slice(0, -5) + 'XXXXX';
      expect(() => verifyToken(tamperedToken)).toThrow();
    });

    test('should verify token with user metadata', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        role: testRole,
      };
      const token = generateToken(payload);
      const decoded = verifyToken(token);

      expect(decoded.userId).toBe(testUserId);
      expect(decoded.email).toBe(testEmail);
      expect(decoded.role).toBe(testRole);
    });
  });

  describe('decodeToken', () => {
    test('should decode valid token without verification', () => {
      const token = generateToken(testUserId);
      const decoded = decodeToken(token);

      expect(decoded).toBeDefined();
      expect(decoded.userId).toBe(testUserId);
    });

    test('should return null for invalid token', () => {
      const decoded = decodeToken('invalid.token');
      expect(decoded).toBeNull();
    });

    test('should not need valid secret to decode', () => {
      const token = generateToken(testUserId);
      /* decodeToken doesn't verify, so it should work even if secret changes */
      const decoded = decodeToken(token);
      expect(decoded.userId).toBe(testUserId);
    });

    test('should preserve all token claims', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        role: testRole,
      };
      const token = generateToken(payload);
      const decoded = decodeToken(token);

      expect(decoded.userId).toBe(testUserId);
      expect(decoded.email).toBe(testEmail);
      expect(decoded.role).toBe(testRole);
      expect(decoded.iat).toBeDefined();
    });
  });
});
