/**
 * Unit tests for validators.edge-cases.test.js
 * Edge cases for input validators
 */

jest.mock('../../src/validators', () => ({
  validateEmail: jest.fn(),
  validatePassword: jest.fn(),
  validateDisplayName: jest.fn(),
  validateEventName: jest.fn(),
  validateSongTitle: jest.fn(),
  validateArtist: jest.fn(),
  validateCode: jest.fn(),
}));

const { ValidationError } = require('../../src/errors');

describe('Validator Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateEmail edge cases', () => {
    const { validateEmail } = require('../../src/validators');

    test('should accept valid email addresses', () => {
      const validEmails = [
        'simple@example.com',
        'with.plus@example.com',
        'subdomain.example.org',
        '123@numbers.net',
      ];

      validEmails.forEach(email => {
        expect(() => validateEmail(email)).not.toThrow();
      });
    });

    test('should reject malformed emails', () => {
      const invalidEmails = [
        '@example.com',
        'no-domain@',
        '@',
        'spaces in@email.com',
        '',
      ];

      invalidEmails.forEach(email => {
        expect(() => validateEmail(email)).toThrow(ValidationError);
      });
    });

    test('should reject local-only reserved names', () => {
      const reserved = ['admin', 'root', 'support'];

      reserved.forEach(name => {
        expect(() => validateEmail(`${name}@example.com`)).toThrow(ValidationError);
      });
    });

    test('should reject unusually long domains', () => {
      const longDomain = 'a'.repeat(64) + '.com';
      expect(() => validateEmail(`test@${longDomain}`)).toThrow();
    });
  });

  describe('validatePassword edge cases', () => {
    const { validatePassword } = require('../../src/validators');

    test('should accept strong passwords', () => {
      expect(() => validatePassword('Str0ng!Pass#123')).not.toThrow();
    });

    test('should reject weak passwords', () => {
      expect(() => validatePassword('short')).toThrow(ValidationError);
      expect(() => validatePassword('allletters')).toThrow(ValidationError);
      expect(() => validatePassword('12345678')).toThrow(ValidationError);
    });

    test('should detect common patterns', () => {
      expect(() => validatePassword('password123')).toThrow(ValidationError);
      expect(() => validatePassword('qwerty')).toThrow(ValidationError);
    });

    test('should handle unicode passwords', () => {
      expect(() => validatePassword('пароль123')).not.toThrow();
    });
  });

  describe('validateDisplayName edge cases', () => {
    const { validateDisplayName } = require('../../src/validators');

    test('should accept various valid names', () => {
      expect(() => validateDisplayName('DJ Bob')).not.toThrow();
      expect(() => validateDisplayName('User123')).not.toThrow();
      expect(() => validateDisplayName('Name with spaces')).not.toThrow();
    });

    test('should reject problematic names', () => {
      expect(() => validateDisplayName('')).toThrow(ValidationError);
      expect(() => validateDisplayName('ab')).toThrow(ValidationError);
      expect(() => validateDisplayName('a'.repeat(51))).toThrow(ValidationError);
    });

    test('should reject special characters attempt', () => {
      expect(() => validateDisplayName('<script>alert(1)</script>')).toThrow(ValidationError);
      expect(() => validateDisplayName('\u0000null')).toThrow(ValidationError);
    });

    test('should trim whitespace', () => {
      expect(() => validateDisplayName('  trimmed  ')).not.toThrow();
    });
  });

  describe('validateEventName edge cases', () => {
    const { validateEventName } = require('../../src/validators');

    test('should accept reasonable event names', () => {
      expect(() => validateEventName('Summer Party 2024')).not.toThrow();
      expect(() => validateEventName('DJ Sessions')).not.toThrow();
    });

    test('should reject problematic names', () => {
      expect(() => validateEventName('  ')).toThrow(ValidationError);
      expect(() => validateEventName('a'.repeat(101))).toThrow(ValidationError);
    });

    test('should handle special characters gracefully', () => {
      expect(() => validateEventName("O'Brien's Night")).not.toThrow();
    });
  });

  describe('validateSongTitle edge cases', () => {
    const { validateSongTitle } = require('../../src/validators');

    test('should accept various title formats', () => {
      expect(() => validateSongTitle('Song Title')).not.toThrow();
      expect(() => validateSongTitle('Title - Subtitle')).not.toThrow();
      expect(() => validateSongTitle('(Remix)')).not.toThrow();
    });

    test('should handle empty titles differently than invalid', () => {
      // Empty might be acceptable with artist match
      expect(() => validateSongTitle('')).not.toThrow(ValidationError);
    });

    test('should reject extremely long titles', () => {
      expect(() => validateSongTitle('a'.repeat(201))).toThrow(ValidationError);
    });
  });

  describe('validateArtist edge cases', () => {
    const { validateArtist } = require('../../src/validators');

    test('should accept featuring formats', () => {
      expect(() => validateArtist('Artist A feat. Artist B')).not.toThrow();
      expect(() => validateArtist('Artist A, Artist B')).not.toThrow();
    });

    test('should handle anonymous/unknown', () => {
      expect(() => validateArtist('Unknown')).not.toThrow();
      expect(() => validateArtist('Various Artists')).not.toThrow();
    });
  });

  describe('validateCode edge cases', () => {
    const { validateCode } = require('../../src/validators');

    test('should accept valid access codes', () => {
      const codes = ['ABCD12', '123456', 'XY7890'];

      codes.forEach(code => {
        expect(() => validateCode(code)).not.toThrow();
      });
    });

    test('should reject invalid codes', () => {
      expect(() => validateCode('ABC')).toThrow(ValidationError);
      expect(() => validateCode('abc123')).toThrow(ValidationError);
      expect(() => validateCode('AB12$9')).toThrow(ValidationError);
    });

    test('should normalize to uppercase', () => {
      expect(() => validateCode('abcd12')).not.toThrow();
    });
  });
});

describe('Security Boundary Cases', () => {
  test('should sanitize SQL injection attempts', () => {
    const { validateEmail } = require('../../src/validators');
    
    const malicious = ["'; DROP TABLE users; --", "admin'--"];
    
    malicious.forEach(input => {
      expect(() => validateEmail(`${input}@test.com`)).toThrow();
    });
  });

  test('should sanitize XSS in display names', () => {
    const { validateDisplayName } = require('../../src/validators');
    
    const xssAttempt = '<script>alert("xss")</script>';
    expect(() => validateDisplayName(xssAttempt)).toThrow();
  });

  test('should handle null bytes properly', () => {
    const { validateDisplayName } = require('../../src/validators');
    
    expect(() => validateDisplayName('Test\u0000Name')).toThrow();
  });

  test('should normalize unicode homoglyphs', () => {
    const { validateEmail } = require('../../src/validators');
    
    // Cyrillic 'a' vs latin 'a' attempt
    expect(() => validateEmail('test@examрle.com')).toThrow();
  });
});

describe('Length Boundary Testing', () => {
  test('should enforce minimum lengths', () => {
    const { validateDisplayName } = require('../../src/validators');
    
    expect(() => validateDisplayName('a')).toThrow();
    expect(() => validateDisplayName('ab')).toThrow();
  });

  test('should enforce maximum lengths', () => {
    const { validateDisplayName } = require('../../src/validators');
    
    const maxPlusOne = 'a'.repeat(51);
    expect(() => validateDisplayName(maxPlusOne)).toThrow();
  });

  test('should handle exact boundary values', () => {
    const { validateDisplayName } = require('../../src/validators');
    
    // Minimum usually 3
    expect(() => validateDisplayName('abc')).not.toThrow();
    
    // Maximum usually 50
    expect(() => validateDisplayName('a'.repeat(50))).not.toThrow();
  });
});