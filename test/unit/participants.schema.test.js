const { participantsSchema } = require('../../src/schemas');

describe('ParticipantsSchema', () => {
  describe('parseJoinEvent', () => {
    test('accepts a normal attendee nickname', () => {
      expect(
        participantsSchema.parseJoinEvent({
          nickname: 'John',
        })
      ).toEqual({
        nickname: 'John',
        profilePicture: null,
        password: undefined,
      });
    });

    test('accepts alphanumeric nicknames that could look like access codes', () => {
      expect(
        participantsSchema.parseJoinEvent({
          nickname: 'ABC123',
        }).nickname
      ).toBe('ABC123');
    });
  });

  describe('parseUpdateProfile', () => {
    test('accepts nickname and profile picture updates', () => {
      expect(
        participantsSchema.parseUpdateProfile({
          nickname: ' Ada ',
          profilePicture: 'avatar-1',
        })
      ).toEqual({
        nickname: 'Ada',
        profilePicture: 'avatar-1',
      });
    });

    test('rejects empty update payloads', () => {
      expect(() => participantsSchema.parseUpdateProfile({})).toThrow(
        'No participant profile updates provided',
      );
    });
  });
});
