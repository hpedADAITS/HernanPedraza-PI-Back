const {
  authSchema,
  eventsSchema,
  participantsSchema,
  songsSchema,
} = require('../../src/schemas');
const { validateLogin } = require('../../src/validators/auth.validator');
const { isValidId, isValidVoteValue } = require('../../src/socket/shared-validators');

const expectInvalid = (fn, message) => expect(fn).toThrow(message);

describe('Current validators and schemas', () => {
  describe('auth schema', () => {
    test('validates email format', () => {
      expect(() => authSchema.validateEmail('test@example.com')).not.toThrow();
      expect(() => authSchema.validateEmail('user.name@domain.co.uk')).not.toThrow();
      expectInvalid(() => authSchema.validateEmail('notanemail'), 'Invalid email');
      expectInvalid(() => authSchema.validateEmail('test@'), 'Invalid email');
      expectInvalid(() => authSchema.validateEmail(null), 'Email is required');
    });

    test('validates password and display name bounds', () => {
      expect(() => authSchema.validatePassword('password123')).not.toThrow();
      expect(() => authSchema.validatePassword('StrongPass123!')).not.toThrow();
      expectInvalid(() => authSchema.validatePassword('1234567'), 'Password must be at least 8 characters');
      expectInvalid(() => authSchema.validatePassword('A'.repeat(129)), 'Password must be less than 128 characters');
      expectInvalid(() => authSchema.validatePassword('pass\nword1'), 'Invalid password');
      expectInvalid(() => authSchema.validatePassword('        '), 'Invalid password');

      expect(() => authSchema.validateDisplayName('John Doe')).not.toThrow();
      expectInvalid(() => authSchema.validateDisplayName('J'), 'Display name must be at least 2 characters');
      expectInvalid(() => authSchema.validateDisplayName('A'.repeat(51)), 'Display name must be less than 50 characters');
    });

    test('validates login passwords on the server', () => {
      expect(() => validateLogin({
        email: 'dj@example.com',
        password: 'StrongPass123!',
      })).not.toThrow();
      expectInvalid(() => validateLogin({
        email: 'dj@example.com',
        password: '1234567',
      }), 'Password must be at least 8 characters');
      expectInvalid(() => validateLogin({
        email: 'dj@example.com',
        password: 'pass\tword1',
      }), 'Invalid password');
      expectInvalid(() => validateLogin({
        email: 'same@example.com',
        password: 'same@example.com',
      }), 'Invalid password');
    });

    test('rejects non-public registration roles', () => {
      expect(() => authSchema.validateRegistration({
        email: 'dj@example.com',
        password: 'password123',
        displayName: 'DJ',
        role: 'DJ',
      })).not.toThrow();
      expectInvalid(() => authSchema.validateRegistration({
        email: 'admin@example.com',
        password: 'password123',
        displayName: 'Admin',
        role: 'ADMIN',
      }), 'Invalid role');
    });
  });

  describe('event schema', () => {
    test('parses and validates event creation', () => {
      const startsAt = new Date().toISOString();
      expect(eventsSchema.parseCreateEvent({
        name: '  Summer Party  ',
        description: '  Rooftop  ',
        startsAt,
        eventId: 'PARTY2026',
      })).toMatchObject({
        name: 'Summer Party',
        description: 'Rooftop',
        startsAt,
        eventId: 'PARTY2026',
      });

      expectInvalid(() => eventsSchema.parseCreateEvent({ name: 'A', startsAt }), 'Event name must be at least 2 characters');
      expectInvalid(() => eventsSchema.parseCreateEvent({ name: 'Party', startsAt, eventId: 'bad id' }), 'Event ID must be alphanumeric');
    });
  });

  describe('song schema', () => {
    test('parses suggestion payloads', () => {
      expect(songsSchema.parseSuggestSong({
        participantId: '507f1f77bcf86cd799439011',
        title: '  Track  ',
        artist: '  Artist  ',
        duration: 123.9,
      })).toMatchObject({
        title: 'Track',
        artist: 'Artist',
        totalDuration: 123,
      });

      expectInvalid(() => songsSchema.parseSuggestSong({ participantId: 'p', title: '', artist: 'A' }), 'Song title is required');
      expectInvalid(() => songsSchema.parseSuggestSong({ participantId: 'p', title: 'T', artist: '' }), 'Artist name is required');
      expectInvalid(() => songsSchema.parseSuggestSong({ participantId: 'p', title: '<script>', artist: 'A' }), 'Song title contains invalid characters');
      expectInvalid(() => songsSchema.parseSuggestSong({ participantId: 'p', title: 'T', artist: 'Bad\u0000Artist' }), 'Artist name contains invalid characters');
    });
  });

  describe('participant schema', () => {
    test('parses join and profile payloads', () => {
      expect(participantsSchema.parseJoinEvent({
        nickname: '  Ada  ',
        profilePicture: 'avatar',
        password: 'password123',
        socialPrefs: { showDisplayName: true },
      })).toMatchObject({
        nickname: 'Ada',
        profilePicture: 'avatar',
        password: 'password123',
        socialPrefs: { showDisplayName: true },
      });

      expectInvalid(() => participantsSchema.parseJoinEvent({ nickname: 'A' }), 'Nickname must be at least 2 characters');
      expectInvalid(() => participantsSchema.parseJoinEvent({ nickname: 'Ada', password: 'bad\npass1' }), 'Invalid password');
      expectInvalid(() => participantsSchema.parseSetPassword({ password: 'short' }), 'Password must be at least 8 characters');
      expectInvalid(() => participantsSchema.parseSetPassword({ password: 'bad\tpass1' }), 'Invalid password');
      expectInvalid(() => participantsSchema.parseUpdateProfile({}), 'No participant profile updates provided');
      expectInvalid(() => participantsSchema.parseJoinEvent({ nickname: 'Ada', socialPrefs: { showDisplayName: 'yes' } }), 'socialPrefs.showDisplayName must be a boolean');
    });

    test('parses admin participant actions', () => {
      expect(participantsSchema.parseCooldown({ durationMs: '5000', reason: '  Spam  ' })).toEqual({
        durationMs: 5000,
        reason: 'Spam',
      });
      expect(participantsSchema.parseSetPremium({ isPremium: true })).toEqual({ isPremium: true });

      expectInvalid(() => participantsSchema.parseCooldown({ durationMs: 999, reason: 'Spam' }), 'Cooldown must be at least 1 second');
      expectInvalid(() => participantsSchema.parseSetPremium({ isPremium: 'true' }), 'isPremium must be a boolean');
    });
  });

  describe('socket shared validators', () => {
    test('validates object ids and vote values', () => {
      expect(isValidId('507f1f77bcf86cd799439011')).toBe(true);
      expect(isValidId('not-an-id')).toBe(false);
      expect(isValidVoteValue(1)).toBe(true);
      expect(isValidVoteValue(-1)).toBe(true);
      expect(isValidVoteValue(0)).toBe(false);
    });
  });
});
