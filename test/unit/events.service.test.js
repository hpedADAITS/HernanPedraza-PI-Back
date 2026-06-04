/**
 * Unit tests for eventsService.js
 * Tests event creation, retrieval, updates, and lifecycle
 */

jest.mock('../../src/models/schema', () => {
  const mockEventInstance = {
    save: jest.fn().mockResolvedValue(true),
    toString: jest.fn(),
  };
  
  const MockEventModel = jest.fn(() => mockEventInstance);
  MockEventModel.findById = jest.fn();
  MockEventModel.findOne = jest.fn();
  MockEventModel.find = jest.fn();
  MockEventModel.prototype = { validateSync: jest.fn() };

  const mockMemberInstance = {
    save: jest.fn().mockResolvedValue(true),
  };
  const MockEventMemberModel = jest.fn(() => mockMemberInstance);
  MockEventMemberModel.findOne = jest.fn();
  MockEventMemberModel.find = jest.fn();

  return {
    EventModel: MockEventModel,
    EventMemberModel: MockEventMemberModel,
    ParticipantModel: {
      find: jest.fn(),
      countDocuments: jest.fn(),
    },
    SongModel: {
      find: jest.fn(),
      countDocuments: jest.fn(),
    },
    UserModel: {
      findById: jest.fn(),
    },
    defaultPermissionsForRole: jest.fn(role => ['ALL']),
  };
});

jest.mock('../../src/services/event-permissions.service', () => ({}));

jest.mock('../../src/utils', () => ({
  generateEventCode: jest.fn(() => 'ABC12345'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/utils/jwt.utils', () => ({
  generateToken: jest.fn(() => 'jwt-token'),
  verifyToken: jest.fn(),
}));

const { EventModel, EventMemberModel, UserModel } = require('../../src/models/schema');
const eventsService = require('../../src/services/events.service');

// Helper to create chainable mock for UserModel.findById
const createUserMock = (userData) => {
  const mock = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(userData),
  };
  UserModel.findById.mockReturnValue(mock);
  return mock;
};

describe('EventsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createEvent', () => {
    test('should create event as DJ', async () => {
      createUserMock({
        _id: 'user-1',
        role: 'DJ',
        emailRegistered: true,
      });

      const result = await eventsService.createEvent(
        { userId: 'user-1', role: 'DJ' },
        'Test Event',
        'Test Description',
        new Date()
      );

      expect(result).toBeDefined();
      expect(EventModel).toHaveBeenCalled();
      expect(EventMemberModel).toHaveBeenCalled();
    });

    test('should throw when user not found', async () => {
      createUserMock(null);

      await expect(eventsService.createEvent(
        { userId: 'nonexistent' },
        'Event',
        'Desc',
        new Date()
      )).rejects.toThrow('User not found');
    });

    test('should throw for non-DJ role', async () => {
      createUserMock({
        _id: 'user-1',
        role: 'ATTENDEE',
        emailRegistered: false,
      });

      await expect(eventsService.createEvent(
        { userId: 'user-1', role: 'ATTENDEE' },
        'Event',
        'Desc',
        new Date()
      )).rejects.toThrow('Only DJs and admins can create events');
    });

    test('should require email verification for DJ', async () => {
      createUserMock({
        _id: 'user-1',
        role: 'DJ',
        emailRegistered: false,
      });

      await expect(eventsService.createEvent(
        { userId: 'user-1', role: 'DJ' },
        'Event',
        'Desc',
        new Date()
      )).rejects.toThrow('Please confirm your email');
    });

    test('should allow ADMIN role without email verification', async () => {
      createUserMock({
        _id: 'user-1',
        role: 'ADMIN',
        emailRegistered: false,
      });

      const result = await eventsService.createEvent(
        { userId: 'user-1', role: 'ADMIN' },
        'Admin Event',
        'Desc',
        new Date()
      );

      expect(result).toBeDefined();
    });
  });

  describe('getEvent', () => {
    test('should return event by ID', async () => {
      const mockEvent = {
        _id: 'event-1',
        name: 'Test Event',
        ownerId: { _id: 'user-1', email: 'dj@test.com', displayName: 'DJ' },
      };

      EventModel.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockEvent),
      });

      const result = await eventsService.getEvent('event-1');

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Event');
    });

    test('should throw NotFoundError for invalid ID', async () => {
      EventModel.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      await expect(eventsService.getEvent('invalid-id')).rejects.toThrow('Event not found');
    });
  });

  describe('getEventByAccessCode', () => {
    test('should return event by access code', async () => {
      const mockEvent = {
        _id: 'event-1',
        name: 'Test Event',
        accessCode: 'ABCD12',
      };

      EventModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockEvent),
      });

      const result = await eventsService.getEventByAccessCode('abcd12');

      expect(result).toBeDefined();
      expect(EventModel.findOne).toHaveBeenCalledWith({
        accessCode: 'ABCD12',
      });
    });

    test('should throw NotFoundError when not found', async () => {
      EventModel.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      await expect(eventsService.getEventByAccessCode('INVALID'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('listActiveEvents', () => {
    test('should return active events', async () => {
      const mockEvents = [
        { _id: 'event-1', name: 'Event 1' },
        { _id: 'event-2', name: 'Event 2' },
      ];

      EventModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(mockEvents),
      });

      const result = await eventsService.listActiveEvents(10, 0);

      expect(result).toHaveLength(2);
    });

    test('should respect pagination', async () => {
      const mockEvents = [];

      const chain = {
        populate: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(mockEvents),
      };
      EventModel.find.mockReturnValue(chain);

      await eventsService.listActiveEvents(5, 10);

      expect(chain.limit).toHaveBeenCalledWith(5);
      expect(chain.skip).toHaveBeenCalledWith(10);
    });
  });

  describe('updateEvent', () => {
    test('should update event name and description', async () => {
      const mockEvent = {
        _id: 'event-1',
        name: 'Old Name',
        description: 'Old Desc',
        ownerId: { toString: () => 'user-1' },
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      const result = await eventsService.updateEvent('event-1', 'user-1', {
        name: 'New Name',
        description: 'New Desc',
      });

      expect(mockEvent.name).toBe('New Name');
      expect(mockEvent.description).toBe('New Desc');
    });

    test('should throw Unauthorized for non-owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'other-user' },
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      await expect(eventsService.updateEvent('event-1', 'user-1', { name: 'New' }))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when not found', async () => {
      EventModel.findById.mockResolvedValue(null);

      await expect(eventsService.updateEvent('invalid-id', 'user-1', {}))
        .rejects.toThrow('Event not found');
    });
  });

  describe('cancelEvent', () => {
    test('should cancel event as owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'user-1' },
        state: 'LIVE',
        cancelledAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      const result = await eventsService.cancelEvent('event-1', 'user-1', 'Test reason');

      expect(mockEvent.state).toBe('CANCELLED');
      expect(mockEvent.cancelledAt).toBeInstanceOf(Date);
      expect(mockEvent.cancelledReason).toBe('Test reason');
    });

    test('should throw Unauthorized for non-owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'other-user' },
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      await expect(eventsService.cancelEvent('event-1', 'user-1', 'reason'))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when event not found', async () => {
      EventModel.findById.mockResolvedValue(null);

      await expect(eventsService.cancelEvent('invalid-id', 'user-1', 'reason'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('startEvent', () => {
    test('should transition event to LIVE state', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'user-1' },
        state: 'DRAFT',
        startsAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      const result = await eventsService.startEvent('event-1', 'user-1');

      expect(mockEvent.state).toBe('LIVE');
    });

    test('should throw Unauthorized for non-owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'other-user' },
        state: 'DRAFT',
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      await expect(eventsService.startEvent('event-1', 'user-1'))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when event not found', async () => {
      EventModel.findById.mockResolvedValue(null);

      await expect(eventsService.startEvent('invalid-id', 'user-1'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('endEvent', () => {
    test('should transition event to ENDED state', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'user-1' },
        state: 'LIVE',
        endedAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      const result = await eventsService.endEvent('event-1', 'user-1');

      expect(mockEvent.state).toBe('ENDED');
      expect(mockEvent.endedAt).toBeInstanceOf(Date);
    });

    test('should throw Unauthorized for non-owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'other-user' },
        state: 'LIVE',
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      await expect(eventsService.endEvent('event-1', 'user-1'))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when event not found', async () => {
      EventModel.findById.mockResolvedValue(null);

      await expect(eventsService.endEvent('invalid-id', 'user-1'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('regenerateAccessCode', () => {
    test('should generate new access code for owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'user-1' },
        accessCode: 'OLD123',
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      const result = await eventsService.regenerateAccessCode('event-1', 'user-1');

      expect(mockEvent.save).toHaveBeenCalled();
    });

    test('should throw Unauthorized for non-owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { toString: () => 'other-user' },
        save: jest.fn().mockResolvedValue(true),
      };

      EventModel.findById.mockResolvedValue(mockEvent);

      await expect(eventsService.regenerateAccessCode('event-1', 'user-1'))
        .rejects.toThrow('Unauthorized');
    });
  });

  describe('getActiveEventForOwner', () => {
    test('should return active event for owner', async () => {
      const mockEvent = {
        _id: 'event-1',
        ownerId: { _id: 'user-1', displayName: 'DJ' },
      };

      const chain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([mockEvent]),
      };
      EventModel.findOne.mockReturnValue(chain);

      const result = await eventsService.getActiveEventForOwner('user-1');

      expect(result).toBeDefined();
    });

    test('should throw when no active event', async () => {
      EventModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(null),
      });

      await expect(eventsService.getActiveEventForOwner('user-1'))
        .rejects.toThrow('Event not found');
    });
  });
});