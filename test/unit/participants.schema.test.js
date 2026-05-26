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
});
