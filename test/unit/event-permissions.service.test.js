/**
 * Unit tests for eventPermissionsService.js
 * Tests permission checks for event operations
 */

jest.mock('../../src/models/schema', () => ({
  EventModel: {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn(),
      }),
    }),
    findOne: jest.fn(),
    prototype: { validateSync: jest.fn() },
  },
  EventMemberModel: {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn(),
      }),
    }),
    find: jest.fn(),
  },
}));

jest.mock('../../src/errors', () => ({
  ForbiddenError: class ForbiddenError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ForbiddenError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(message) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor(message) {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

const { EventModel, EventMemberModel } = require('../../src/models/schema');
const eventPermissionsService = require('../../src/services/event-permissions.service');

describe('EventPermissionsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getEvent', () => {
    test('should return event ownerId', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'user-1',
          }),
        }),
      });

      const result = await eventPermissionsService.getEvent('event-1');

      expect(result.ownerId).toBe('user-1');
    });

    test('should throw NotFoundError when not found', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(eventPermissionsService.getEvent('invalid-id'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('getContext', () => {
    test('should identify owner correctly', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });

      const result = await eventPermissionsService.getContext('event-1', {
        userId: 'owner-user',
        role: 'DJ',
      });

      expect(result.isOwner).toBe(true);
    });

    test('should identify DJ role correctly', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'other-user',
          }),
        }),
      });

      const result = await eventPermissionsService.getContext('event-1', {
        userId: 'dj-user',
        role: 'DJ',
      });

      expect(result.isAdmin).toBe(true);
      expect(result.isOwner).toBe(false);
    });

    test('should identify ADMIN role correctly', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'other-user',
          }),
        }),
      });

      const result = await eventPermissionsService.getContext('event-1', {
        userId: 'admin-user',
        role: 'ADMIN',
      });

      expect(result.isAdmin).toBe(true);
    });

    test('should fetch member permissions for regular user', async () => {
      const mockMember = {
        _id: 'member-1',
        role: 'ATTENDEE',
        permissions: ['SONG_UPVOTE'],
      };

      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });
      EventMemberModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMember),
        }),
      });

      const result = await eventPermissionsService.getContext('event-1', {
        userId: 'regular-user',
        role: 'ATTENDEE',
      });

      expect(result.member).toEqual(mockMember);
    });

    test('should return null userId for unauthenticated actor', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });

      const result = await eventPermissionsService.getContext('event-1', null);

      expect(result.userId).toBeNull();
    });
  });

  describe('hasAnyPermission', () => {
    test('should return true for admin', () => {
      const context = { isAdmin: true, isOwner: false, member: null };

      const result = eventPermissionsService.hasAnyPermission(context, ['ANY']);

      expect(result).toBe(true);
    });

    test('should return true for owner', () => {
      const context = { isAdmin: false, isOwner: true, member: null };

      const result = eventPermissionsService.hasAnyPermission(context, ['ANY']);

      expect(result).toBe(true);
    });

    test('should check member permissions', () => {
      const context = {
        isAdmin: false,
        isOwner: false,
        member: {
          permissions: ['SONG_APPROVE_REJECT', 'PARTICIPANT_KICK'],
        },
      };

      const hasKick = eventPermissionsService.hasAnyPermission(context, ['PARTICIPANT_KICK']);
      const hasNonExistent = eventPermissionsService.hasAnyPermission(context, ['EVENT_DELETE']);

      expect(hasKick).toBe(true);
      expect(hasNonExistent).toBe(false);
    });

    test('should return false for non-member', () => {
      const context = {
        isAdmin: false,
        isOwner: false,
        member: null,
      };

      const result = eventPermissionsService.hasAnyPermission(context, ['SOME_PERM']);

      expect(result).toBe(false);
    });
  });

  describe('isEventDj', () => {
    test('should return true for admin', () => {
      const context = { isAdmin: true, isOwner: false, member: null };

      expect(eventPermissionsService.isEventDj(context)).toBe(true);
    });

    test('should return true for owner', () => {
      const context = { isAdmin: false, isOwner: true, member: null };

      expect(eventPermissionsService.isEventDj(context)).toBe(true);
    });

    test('should return true for member with DJ role', () => {
      const context = {
        isAdmin: false,
        isOwner: false,
        member: { role: 'DJ' },
      };

      expect(eventPermissionsService.isEventDj(context)).toBe(true);
    });

    test('should return false for regular attendee', () => {
      const context = {
        isAdmin: false,
        isOwner: false,
        member: { role: 'ATTENDEE' },
      };

      expect(eventPermissionsService.isEventDj(context)).toBe(false);
    });
  });

  describe('assertEventDj', () => {
    test('should allow owner to manage event', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'user-1',
          }),
        }),
      });

      const result = await eventPermissionsService.assertEventDj('event-1', {
        userId: 'user-1',
      });

      expect(result).toBeDefined();
    });

    test('should allow DJ to manage event', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'other-user',
          }),
        }),
      });

      await expect(
        eventPermissionsService.assertEventDj('event-1', {
          userId: 'dj-user',
          role: 'DJ',
        })
      ).resolves.toBeDefined();
    });

    test('should throw for regular attendee', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'other-user',
          }),
        }),
      });
      EventMemberModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        eventPermissionsService.assertEventDj('event-1', {
          userId: 'regular-user',
          role: 'ATTENDEE',
        })
      ).rejects.toThrow('You do not have permission');
    });
  });

  describe('assertSongAdmin', () => {
    test('should allow owner to approve/reject songs', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'user-1',
          }),
        }),
      });

      const result = await eventPermissionsService.assertSongAdmin('event-1', {
        userId: 'user-1',
      });

      expect(result).toBeDefined();
    });

    test('should allow DJ to approve/reject songs', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'other-user',
          }),
        }),
      });

      const result = await eventPermissionsService.assertSongAdmin('event-1', {
        userId: 'dj-user',
        role: 'DJ',
      });

      expect(result).toBeDefined();
    });

    test('should allow member with SONG_APPROVE_REJECT permission', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });
      EventMemberModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            role: 'ATTENDEE',
            permissions: ['SONG_APPROVE_REJECT'],
          }),
        }),
      });

      const result = await eventPermissionsService.assertSongAdmin('event-1', {
        userId: 'perm-user',
        role: 'ATTENDEE',
      });

      expect(result).toBeDefined();
    });

    test('should throw for member without song permissions', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });
      EventMemberModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            role: 'ATTENDEE',
            permissions: [],
          }),
        }),
      });

      await expect(
        eventPermissionsService.assertSongAdmin('event-1', {
          userId: 'no-perm-user',
          role: 'ATTENDEE',
        })
      ).rejects.toThrow('do not have permission');
    });
  });

  describe('assertParticipantAdmin', () => {
    test('should check participant management permissions', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });
      EventMemberModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            role: 'ATTENDEE',
            permissions: ['PARTICIPANT_KICK'],
          }),
        }),
      });

      const result = await eventPermissionsService.assertParticipantAdmin('event-1', {
        userId: 'perm-user',
      });

      expect(result).toBeDefined();
    });
  });

  describe('assertPhoneMicrophone', () => {
    test('should check phone microphone permissions', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });
      EventMemberModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            role: 'PHONE',
            permissions: ['EVENT_SETTINGS_EDIT', 'QUEUE_EDIT'],
          }),
        }),
      });

      const result = await eventPermissionsService.assertPhoneMicrophone('event-1', {
        userId: 'phone-user',
        role: 'PHONE',
      });

      expect(result).toBeDefined();
    });
  });

  describe('assertOwner', () => {
    test('should allow only owner', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });

      const result = await eventPermissionsService.assertOwner('event-1', {
        userId: 'owner-user',
        role: 'DJ',
      });

      expect(result).toBeDefined();
    });

    test('should allow admin', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });

      const result = await eventPermissionsService.assertOwner('event-1', {
        userId: 'admin-user',
        role: 'ADMIN',
      });

      expect(result).toBeDefined();
    });

    test('should throw for non-admin', async () => {
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'event-1',
            ownerId: 'owner-user',
          }),
        }),
      });
      EventMemberModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        eventPermissionsService.assertOwner('event-1', {
          userId: 'other-user',
          role: 'ATTENDEE',
        })
      ).rejects.toThrow('Unauthorized');
    });
  });
});