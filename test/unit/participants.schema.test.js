const { participantsSchema } = require('../../src/schemas');
const { ValidationError } = require('../../src/errors');

describe('ParticipantsSchema', () => {
  describe('parseJoinEvent', () => {
    test('accepts a normal attendee nickname', () => {
      expect(
        participantsSchema.parseJoinEvent({
          nickname: 'Party_Ada',
        })
      ).toEqual({
        nickname: 'Party_Ada',
        profilePicture: null,
        password: undefined,
      });
    });

    test('rejects nicknames that look like valid event access codes', () => {
      expect(() =>
        participantsSchema.parseJoinEvent({
          nickname: 'ABCD1234',
        })
      ).toThrow(new ValidationError('Nickname cannot be a valid access code'));
    });
  });
});
