/**
 * Auth Validator Tests
 * Tests for email and password validation with robust regex patterns
 */

const {
  validateEmail,
  validatePassword,
  validateDisplayName,
  validateRegistration,
  validateLogin,
} = require('../../../src/validators/auth.validator');
const { ValidationError } = require('../../../src/errors');

describe('Auth Validator', () => {
  describe('validateEmail', () => {
    describe('Valid emails', () => {
      const validEmails = [
        'user@example.com',
        'john.doe@example.com',
        'jane_smith@example.co.uk',
        'test-email@domain.org',
        'alice123@test-domain.com',
        'user+tag@example.com',
        'simple@a.co',
        'test_user@sub.domain.example.com',
        'valid.email.address@example.co.uk',
        'user@example-domain.com',
      ];

      validEmails.forEach((email) => {
        it(`should accept "${email}"`, () => {
          expect(() => validateEmail(email)).not.toThrow();
        });
      });
    });

    describe('Invalid emails', () => {
      const invalidEmails = [
        { email: 'missing-at-sign.com', reason: 'no @ symbol' },
        { email: '@example.com', reason: 'no local part' },
        { email: 'user@', reason: 'no domain' },
        { email: 'user@domain', reason: 'no TLD' },
        { email: 'user..name@example.com', reason: 'consecutive dots in local part' },
        { email: '.user@example.com', reason: 'starts with dot' },
        { email: 'user.@example.com', reason: 'ends with dot' },
        { email: 'user@.example.com', reason: 'domain starts with dot' },
        { email: 'user@example..com', reason: 'consecutive dots in domain' },
        { email: 'user name@example.com', reason: 'space in email' },
        { email: 'user@exam ple.com', reason: 'space in domain' },
        { email: '', reason: 'empty string' },
        { email: null, reason: 'null value' },
        { email: 'plaintext', reason: 'plaintext without @' },
      ];

      invalidEmails.forEach(({ email, reason }) => {
        it(`should reject "${email}" (${reason})`, () => {
          expect(() => validateEmail(email)).toThrow(ValidationError);
        });
      });
    });

    it('should reject email longer than 254 characters', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(() => validateEmail(longEmail)).toThrow(ValidationError);
    });
  });

  describe('validatePassword', () => {
    describe('Valid passwords', () => {
      const validPasswords = [
        'Secure@Pass1',
        'MyP@ssw0rd',
        'Complex!Password123',
        'Str0ng$Password',
        'ValidPass#2024',
        'Secure@Pass1!',
        'Aa1!bcdefghij',
        'Z9$xDeFg',
        'P@ssW0rd!',
        'Test123$Pwd',
      ];

      validPasswords.forEach((password) => {
        it(`should accept "${password}"`, () => {
          expect(() => validatePassword(password)).not.toThrow();
        });
      });
    });

    describe('Invalid passwords - length', () => {
      it('should reject password shorter than 8 characters', () => {
        expect(() => validatePassword('Sh0rt!P')).toThrow(ValidationError);
      });

      it('should reject password longer than 128 characters', () => {
        const longPassword = 'A'.repeat(126) + 'a1!';
        expect(() => validatePassword(longPassword)).toThrow(ValidationError);
      });
    });

    describe('Invalid passwords - missing uppercase', () => {
      const passwordsWithoutUppercase = [
        'lowercase@1234',
        'nouppercase!1',
        'weak@pass1',
        'simple!password1',
      ];

      passwordsWithoutUppercase.forEach((password) => {
        it(`should reject "${password}" (no uppercase)`, () => {
          expect(() => validatePassword(password)).toThrow(
            /uppercase/i,
          );
        });
      });
    });

    describe('Invalid passwords - missing lowercase', () => {
      const passwordsWithoutLowercase = [
        'NOLOWERCASE@1234',
        'UPPERCASE!1',
        'WEAK@PASS1',
        'SIMPLE!PASSWORD1',
      ];

      passwordsWithoutLowercase.forEach((password) => {
        it(`should reject "${password}" (no lowercase)`, () => {
          expect(() => validatePassword(password)).toThrow(
            /lowercase/i,
          );
        });
      });
    });

    describe('Invalid passwords - missing digit', () => {
      const passwordsWithoutDigit = [
        'NoDigit@Password',
        'WithoutNumber!',
        'Missing$Numbers',
        'NoNumbers!AtAll',
      ];

      passwordsWithoutDigit.forEach((password) => {
        it(`should reject "${password}" (no digit)`, () => {
          expect(() => validatePassword(password)).toThrow(
            /digit/i,
          );
        });
      });
    });

    describe('Invalid passwords - missing special character', () => {
      const passwordsWithoutSpecial = [
        'NoSpecial1234',
        'Password1NoSpec',
        'Missing1Special',
        'NoSpecialChars1',
      ];

      passwordsWithoutSpecial.forEach((password) => {
        it(`should reject "${password}" (no special character)`, () => {
          expect(() => validatePassword(password)).toThrow(
            /special character/i,
          );
        });
      });
    });

    it('should reject null password', () => {
      expect(() => validatePassword(null)).toThrow(ValidationError);
    });

    it('should reject undefined password', () => {
      expect(() => validatePassword(undefined)).toThrow(ValidationError);
    });

    it('should reject non-string password', () => {
      expect(() => validatePassword(123456789)).toThrow(ValidationError);
    });
  });

  describe('validateDisplayName', () => {
    describe('Valid display names', () => {
      const validNames = [
        'John Doe',
        'DJ Alex',
        'User123',
        'María García',
        'Jean-Pierre',
      ];

      validNames.forEach((name) => {
        it(`should accept "${name}"`, () => {
          expect(() => validateDisplayName(name)).not.toThrow();
        });
      });
    });

    describe('Invalid display names', () => {
      it('should reject display name shorter than 2 characters', () => {
        expect(() => validateDisplayName('A')).toThrow(ValidationError);
      });

      it('should reject display name longer than 50 characters', () => {
        expect(() => validateDisplayName('A'.repeat(51))).toThrow(ValidationError);
      });

      it('should reject null display name', () => {
        expect(() => validateDisplayName(null)).toThrow(ValidationError);
      });
    });
  });

  describe('validateRegistration', () => {
    it('should accept valid registration data', () => {
      const validData = {
        email: 'user@example.com',
        password: 'Secure@Pass1',
        displayName: 'John Doe',
      };
      expect(() => validateRegistration(validData)).not.toThrow();
    });

    it('should accept valid registration with role', () => {
      const validData = {
        email: 'dj@example.com',
        password: 'MyP@ssw0rd',
        displayName: 'DJ Alex',
        role: 'DJ',
      };
      expect(() => validateRegistration(validData)).not.toThrow();
    });

    it('should reject invalid email in registration', () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'Secure@Pass1',
        displayName: 'John Doe',
      };
      expect(() => validateRegistration(invalidData)).toThrow(ValidationError);
    });

    it('should reject weak password in registration', () => {
      const invalidData = {
        email: 'user@example.com',
        password: 'weak123',
        displayName: 'John Doe',
      };
      expect(() => validateRegistration(invalidData)).toThrow(ValidationError);
    });

    it('should reject invalid role', () => {
      const invalidData = {
        email: 'user@example.com',
        password: 'Secure@Pass1',
        displayName: 'John Doe',
        role: 'SUPERADMIN',
      };
      expect(() => validateRegistration(invalidData)).toThrow(ValidationError);
    });
  });

  describe('validateLogin', () => {
    it('should accept valid login credentials', () => {
      const validData = {
        email: 'user@example.com',
        password: 'Secure@Pass1',
      };
      expect(() => validateLogin(validData)).not.toThrow();
    });

    it('should reject missing email', () => {
      const invalidData = {
        password: 'Secure@Pass1',
      };
      expect(() => validateLogin(invalidData)).toThrow(ValidationError);
    });

    it('should reject missing password', () => {
      const invalidData = {
        email: 'user@example.com',
      };
      expect(() => validateLogin(invalidData)).toThrow(ValidationError);
    });

    it('should reject invalid email format', () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'Secure@Pass1',
      };
      expect(() => validateLogin(invalidData)).toThrow(ValidationError);
    });
  });
});
