const { participantsSchema, friendsSchema } = require('../../src/schemas');

describe('ParticipantsSchema', () => {
  describe('parseJoinEvent', () => {
    test('accepts a normal attendee nickname', () => {
      expect(
        participantsSchema.parseJoinEvent({
          nickname: 'John',
        }),
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
        }).nickname,
      ).toBe('ABC123');
    });

    test('parses socialPrefs when provided', () => {
      const data = participantsSchema.parseJoinEvent({
        nickname: 'Ada',
        socialPrefs: { showDisplayName: false, allowFriendRequests: true },
      });
      /* The schema is a parser: it only includes the keys the caller
         actually sent. The service layer is responsible for merging with
         the previous default state. */
      expect(data.socialPrefs).toEqual({
        showDisplayName: false,
        allowFriendRequests: true,
      });
    });

    test('rejects non-boolean social pref values', () => {
      expect(() =>
        participantsSchema.parseJoinEvent({
          nickname: 'Ada',
          socialPrefs: { showDisplayName: 'yes' },
        }),
      ).toThrow(/showDisplayName must be a boolean/);
    });
  });

  describe('parseUpdateProfile', () => {
    test('accepts nickname and profile picture updates', () => {
      expect(
        participantsSchema.parseUpdateProfile({
          nickname: ' Ada ',
          profilePicture: 'avatar-1',
        }),
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

    test('accepts social-pref-only updates', () => {
      const data = participantsSchema.parseUpdateProfile({
        socialPrefs: { showProfilePicture: false },
      });
      expect(data.socialPrefs).toEqual({ showProfilePicture: false });
    });
  });
});

describe('FriendsSchema', () => {
  test('parseSendRequest accepts a valid toUserId', () => {
    const data = friendsSchema.parseSendRequest({
      toUserId: '507f1f77bcf86cd799439011',
      message: '  hi  ',
    });
    expect(data).toEqual({
      toUserId: '507f1f77bcf86cd799439011',
      message: 'hi',
    });
  });

  test('parseSendRequest rejects missing toUserId', () => {
    expect(() => friendsSchema.parseSendRequest({})).toThrow(
      'toUserId is required',
    );
  });

  test('parseRespondRequest accepts a boolean', () => {
    expect(friendsSchema.parseRespondRequest({ accept: true })).toEqual({
      accept: true,
    });
    expect(friendsSchema.parseRespondRequest({ accept: false })).toEqual({
      accept: false,
    });
  });

  test('parseRespondRequest rejects non-boolean', () => {
    expect(() => friendsSchema.parseRespondRequest({ accept: 1 })).toThrow(
      'accept must be a boolean',
    );
  });

  test('parseInvite normalises the event code', () => {
    const data = friendsSchema.parseInvite({
      friendId: '507f1f77bcf86cd799439011',
      eventCode: ' djparty ',
      message: 'come',
    });
    expect(data.eventCode).toBe('DJPARTY');
    expect(data.message).toBe('come');
  });

  test('parseInvite rejects missing event code', () => {
    expect(() =>
      friendsSchema.parseInvite({
        friendId: '507f1f77bcf86cd799439011',
      }),
    ).toThrow('eventCode is required');
  });
});
