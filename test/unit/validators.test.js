const { validators } = require('../../src/utils/validators');

describe('Validators', () => {
  describe('email validation', () => {
    test('should validate correct email format', () => {
      expect(validators.email('test@example.com')).toBe(true);
      expect(validators.email('user.name@domain.co.uk')).toBe(true);
    });

    test('should reject invalid email format', () => {
      expect(validators.email('notanemail')).toBe(false);
      expect(validators.email('test@')).toBe(false);
      expect(validators.email('@example.com')).toBe(false);
    });

    test('should reject null or non-string email', () => {
      expect(validators.email(null)).toBe(false);
      expect(validators.email(undefined)).toBe(false);
      expect(validators.email(123)).toBe(false);
      expect(validators.email('')).toBe(false);
    });
  });

  describe('password validation', () => {
    test('should validate password with minimum length', () => {
      expect(validators.password('password123')).toBe(true);
      expect(validators.password('123456')).toBe(true);
    });

    test('should reject password shorter than minimum', () => {
      expect(validators.password('12345')).toBe(false);
      expect(validators.password('abc')).toBe(false);
    });

    test('should reject null or non-string password', () => {
      expect(validators.password(null)).toBe(false);
      expect(validators.password(undefined)).toBe(false);
      expect(validators.password(123)).toBe(false);
    });
  });

  describe('strong password validation', () => {
    test('should validate strong password with mixed case, numbers and special chars', () => {
      expect(validators.strongPassword('SecurePass123!')).toBe(true);
      expect(validators.strongPassword('Test@1234')).toBe(true);
    });

    test('should reject password without uppercase', () => {
      expect(validators.strongPassword('securepass123!')).toBe(false);
    });

    test('should reject password without lowercase', () => {
      expect(validators.strongPassword('SECUREPASS123!')).toBe(false);
    });

    test('should reject password without number', () => {
      expect(validators.strongPassword('SecurePass!')).toBe(false);
    });

    test('should reject password without special character', () => {
      expect(validators.strongPassword('SecurePass123')).toBe(false);
    });

    test('should reject password shorter than 8 characters', () => {
      expect(validators.strongPassword('Pass@1')).toBe(false);
    });
  });

  describe('displayName validation', () => {
    test('should validate valid display name', () => {
      expect(validators.displayName('John Doe')).toBe(true);
      expect(validators.displayName('JD')).toBe(true);
      expect(validators.displayName('A'.repeat(100))).toBe(true);
    });

    test('should reject name too short', () => {
      expect(validators.displayName('J')).toBe(false);
      expect(validators.displayName('')).toBe(false);
    });

    test('should reject name too long', () => {
      expect(validators.displayName('A'.repeat(101))).toBe(false);
    });

    test('should reject null or non-string', () => {
      expect(validators.displayName(null)).toBe(false);
      expect(validators.displayName(123)).toBe(false);
    });
  });

  describe('eventName validation', () => {
    test('should validate valid event name', () => {
      expect(validators.eventName('Summer Party')).toBe(true);
      expect(validators.eventName('ABC')).toBe(true);
    });

    test('should reject event name too short', () => {
      expect(validators.eventName('AB')).toBe(false);
      expect(validators.eventName('')).toBe(false);
    });

    test('should reject event name too long', () => {
      expect(validators.eventName('A'.repeat(201))).toBe(false);
    });
  });

  describe('songTitle validation', () => {
    test('should validate valid song title', () => {
      expect(validators.songTitle('Bohemian Rhapsody')).toBe(true);
      expect(validators.songTitle('A')).toBe(true);
    });

    test('should reject empty song title', () => {
      expect(validators.songTitle('')).toBe(false);
    });

    test('should reject song title too long', () => {
      expect(validators.songTitle('A'.repeat(256))).toBe(false);
    });
  });

  describe('nickname validation', () => {
    test('should validate valid nickname', () => {
      expect(validators.nickname('john_doe')).toBe(true);
      expect(validators.nickname('user123')).toBe(true);
      expect(validators.nickname('nick-name')).toBe(true);
    });

    test('should reject nickname with invalid characters', () => {
      expect(validators.nickname('john@doe')).toBe(false);
      expect(validators.nickname('john doe')).toBe(false);
      expect(validators.nickname('john!')).toBe(false);
    });

    test('should reject nickname too short', () => {
      expect(validators.nickname('j')).toBe(false);
    });

    test('should reject nickname too long', () => {
      expect(validators.nickname('a'.repeat(51))).toBe(false);
    });
  });

  describe('objectId validation', () => {
    test('should validate correct MongoDB ObjectId', () => {
      expect(validators.objectId('507f1f77bcf86cd799439011')).toBe(true);
    });

    test('should reject invalid ObjectId format', () => {
      expect(validators.objectId('not-an-id')).toBe(false);
      expect(validators.objectId('507f1f77bcf86cd79943901')).toBe(false); // too short
      expect(validators.objectId('507f1f77bcf86cd7994390111')).toBe(false); // too long
    });

    test('should reject non-hex characters', () => {
      expect(validators.objectId('507f1f77bcf86cd79943901g')).toBe(false);
    });
  });

  describe('nonNegativeNumber validation', () => {
    test('should validate non-negative numbers', () => {
      expect(validators.nonNegativeNumber(0)).toBe(true);
      expect(validators.nonNegativeNumber(42)).toBe(true);
      expect(validators.nonNegativeNumber(999)).toBe(true);
    });

    test('should reject negative numbers', () => {
      expect(validators.nonNegativeNumber(-1)).toBe(false);
      expect(validators.nonNegativeNumber(-100)).toBe(false);
    });

    test('should reject non-number values', () => {
      expect(validators.nonNegativeNumber('42')).toBe(false);
      expect(validators.nonNegativeNumber(null)).toBe(false);
    });
  });
});
