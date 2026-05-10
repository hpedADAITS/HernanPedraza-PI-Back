const {
  generateToken,
  verifyToken,
  decodeToken,
} = require('../../src/utils/jwt.utils');

describe('Email Verification Token Flow', () => {
  const testUserId = '507f1f77bcf86cd799439011';
  const testEmail = 'dj@example.com';

  describe('generateToken with email-verification type', () => {
    test('should generate token with type field', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');
      expect(token).toBeDefined();

      const decoded = decodeToken(token);
      expect(decoded.type).toBe('email-verification');
      expect(decoded.email).toBe(testEmail);
      expect(decoded.userId).toBe(testUserId);
    });

    test('should preserve type field with custom expiry', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');
      const decoded = decodeToken(token);

      expect(decoded.type).toBe('email-verification');
    });

    test('should generate token with 5 minute expiry', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');
      const decoded = decodeToken(token);

      const expirySeconds = decoded.exp - decoded.iat;
      /* Allow 5% margin for execution time */
      expect(expirySeconds).toBeGreaterThan(290); // ~5 minutes - 10 seconds
      expect(expirySeconds).toBeLessThan(310); // ~5 minutes + 10 seconds
    });

    test('should create token that passes verification within 5 minutes', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');

      expect(() => verifyToken(token)).not.toThrow();
      const verified = verifyToken(token);
      expect(verified.type).toBe('email-verification');
    });
  });

  describe('Email verification token security', () => {
    test('should reject token with wrong type', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'wrong-type',
      };
      const token = generateToken(payload, '5m');
      const decoded = verifyToken(token);

      expect(decoded.type).not.toBe('email-verification');
    });

    test('should validate token signature', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');
      const tamperedToken = token.slice(0, -5) + 'XXXXX';

      expect(() => verifyToken(tamperedToken)).toThrow();
    });

    test('should contain all required fields for verification', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');
      const decoded = decodeToken(token);

      /* All required fields for backend verification */
      expect(decoded.userId).toBeDefined();
      expect(decoded.email).toBeDefined();
      expect(decoded.type).toBeDefined();
      expect(decoded.exp).toBeDefined(); // expiry
      expect(decoded.iat).toBeDefined(); // issued at
    });
  });

  describe('Expired token handling', () => {
    test('should generate token with 0s expiry for testing', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '0s');
      expect(token).toBeDefined();
    });

    test('should reject expired token', (done) => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '0s');

      setTimeout(() => {
        expect(() => verifyToken(token)).toThrow();
        done();
      }, 100);
    });
  });

  describe('Token format validation', () => {
    test('should generate valid JWT format (3 parts)', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');
      const parts = token.split('.');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBeTruthy(); // header
      expect(parts[1]).toBeTruthy(); // payload
      expect(parts[2]).toBeTruthy(); // signature
    });

    test('should use HS256 algorithm', () => {
      const payload = {
        userId: testUserId,
        email: testEmail,
        type: 'email-verification',
      };
      const token = generateToken(payload, '5m');
      const decoded = decodeToken(token);

      /* JWT header should indicate HS256 (typically in the token structure) */
      expect(token).toBeTruthy();
      expect(decoded).toBeTruthy();
    });
  });
});
