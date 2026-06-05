/**
 * Unit tests for eventsService.js - UNMOCKED
 * Tests event creation, retrieval, updates, and lifecycle using REAL implementations
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  UserModel,
} = require('../../src/models/schema');
const eventsService = require('../../src/services/events.service');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    EventModel.deleteMany({}),
    EventMemberModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    SongModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

// Helper to create a real test user
const createTestUser = async (overrides = {}) => {
  return UserModel.create({
    email: `user-${Date.now()}@test.com`,
    passwordHash: 'hashed',
    displayName: 'Test User',
    role: 'DJ',
    isActive: true,
    emailRegistered: true,
    ...overrides,
  });
};

// Helper to create a real event with required fields
const createTestEvent = async (user, overrides = {}) => {
  return EventModel.create({
    name: 'Test Event',
    ownerId: user._id,
    eventId: `EVENT-${Date.now()}`,
    accessCode: `TEST${Date.now()}`,
    state: 'DRAFT',
    startsAt: new Date(),
    ...overrides,
  });
};

describe('EventsService - Real Implementation Tests', () => {
  describe('createEvent', () => {
    test('should create event as DJ', async () => {
      const user = await createTestUser({ role: 'DJ', emailRegistered: true });

      const result = await eventsService.createEvent(
        { userId: user._id.toString(), role: 'DJ' },
        'Test Event',
        'Test Description',
        new Date()
      );

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Event');
      expect(result.ownerId.toString()).toBe(user._id.toString());
      
      // Verify event was saved
      const savedEvent = await EventModel.findById(result._id);
      expect(savedEvent).toBeDefined();
    });

    test('should throw when user not found', async () => {
      const fakeUserId = new mongoose.Types.ObjectId();

      await expect(eventsService.createEvent(
        { userId: fakeUserId.toString(), role: 'DJ' },
        'Event',
        'Desc',
        new Date()
      )).rejects.toThrow('User not found');
    });

    test('should throw for non-DJ role', async () => {
      const user = await createTestUser({ role: 'ATTENDEE' });

      await expect(eventsService.createEvent(
        { userId: user._id.toString(), role: 'ATTENDEE' },
        'Event',
        'Desc',
        new Date()
      )).rejects.toThrow('Only DJs and admins can create events');
    });

    test('should require email verification for DJ', async () => {
      const user = await createTestUser({ role: 'DJ', emailRegistered: false });

      await expect(eventsService.createEvent(
        { userId: user._id.toString(), role: 'DJ' },
        'Event',
        'Desc',
        new Date()
      )).rejects.toThrow('Please confirm your email');
    });

    test('should allow ADMIN role without email verification', async () => {
      const user = await createTestUser({ role: 'ADMIN', emailRegistered: false });

      const result = await eventsService.createEvent(
        { userId: user._id.toString(), role: 'ADMIN' },
        'Admin Event',
        'Desc',
        new Date()
      );

      expect(result).toBeDefined();
    });
  });

  describe('getEvent', () => {
    test('should return event by ID', async () => {
      const user = await createTestUser();
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.getEvent(event._id.toString());

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Event');
    });

    test('should throw NotFoundError for invalid ID', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(eventsService.getEvent(fakeId.toString())).rejects.toThrow('Event not found');
    });
  });

  describe('getEventByAccessCode', () => {
    test('should return event by access code', async () => {
      const user = await createTestUser();
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: 'ABCD12',
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.getEventByAccessCode('abcd12');

      expect(result).toBeDefined();
      expect(result.accessCode).toBe('ABCD12');
    });

    test('should throw NotFoundError when not found', async () => {
      await expect(eventsService.getEventByAccessCode('INVALID'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('listActiveEvents', () => {
    test('should return active events', async () => {
      const user = await createTestUser();
      
      await EventModel.create({
        name: 'Event 1',
        ownerId: user._id,
        eventId: `EVENT-1-${Date.now()}`,
        accessCode: `TEST1${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });
      await EventModel.create({
        name: 'Event 2',
        ownerId: user._id,
        eventId: `EVENT-2-${Date.now()}`,
        accessCode: `TEST2${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.listActiveEvents(10, 0);

      expect(result).toHaveLength(2);
    });

    test('should respect pagination', async () => {
      const user = await createTestUser();
      
      // Create 5 events
      for (let i = 0; i < 5; i++) {
        await EventModel.create({
          name: `Event ${i}`,
          ownerId: user._id,
          eventId: `EVENT-${i}-${Date.now()}`,
          accessCode: `TEST${i}${Date.now()}`,
          state: 'LIVE',
        startsAt: new Date(),
        });
      }

      const result = await eventsService.listActiveEvents(2, 0);

      expect(result).toHaveLength(2);
    });
  });

  describe('updateEvent', () => {
    test('should update event name and description', async () => {
      const user = await createTestUser();
      const event = await EventModel.create({
        name: 'Old Name',
        description: 'Old Desc',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.updateEvent(event._id.toString(), user._id.toString(), {
        name: 'New Name',
        description: 'New Desc',
      });

      expect(result.name).toBe('New Name');
      expect(result.description).toBe('New Desc');
    });

    test('should throw Unauthorized for non-owner', async () => {
      const owner = await createTestUser();
      const otherUser = await createTestUser({ email: 'other@test.com' });
      
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: owner._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      await expect(eventsService.updateEvent(event._id.toString(), otherUser._id.toString(), { name: 'New' }))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when not found', async () => {
      const user = await createTestUser();
      const fakeId = new mongoose.Types.ObjectId();

      await expect(eventsService.updateEvent(fakeId.toString(), user._id.toString(), {}))
        .rejects.toThrow('Event not found');
    });
  });

  describe('cancelEvent', () => {
    test('should cancel event as owner', async () => {
      const user = await createTestUser();
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.cancelEvent(event._id.toString(), user._id.toString(), 'Test reason');

      expect(result.state).toBe('CANCELLED');
      
      // Verify was saved with the reason
      const savedEvent = await EventModel.findById(event._id);
      expect(savedEvent.state).toBe('CANCELLED');
      expect(savedEvent.cancelledReason).toBe('Test reason');
    });

    test('should throw Unauthorized for non-owner', async () => {
      const owner = await createTestUser();
      const otherUser = await createTestUser({ email: 'other@test.com' });
      
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: owner._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      await expect(eventsService.cancelEvent(event._id.toString(), otherUser._id.toString(), 'reason'))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when event not found', async () => {
      const user = await createTestUser();
      const fakeId = new mongoose.Types.ObjectId();

      await expect(eventsService.cancelEvent(fakeId.toString(), user._id.toString(), 'reason'))
        .rejects.toThrow('Event not found');
    });
  });

  describe('startEvent', () => {
    test('should transition event to LIVE state', async () => {
      const user = await createTestUser();
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'DRAFT',
        startsAt: new Date(),
      });

      const result = await eventsService.startEvent(event._id.toString(), user._id.toString());

      expect(result.state).toBe('LIVE');
    });

    test('should throw Unauthorized for non-owner', async () => {
      const owner = await createTestUser();
      const otherUser = await createTestUser({ email: 'other@test.com' });
      
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: owner._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'DRAFT',
        startsAt: new Date(),
      });

      await expect(eventsService.startEvent(event._id.toString(), otherUser._id.toString()))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when event not found', async () => {
      const user = await createTestUser();
      const fakeId = new mongoose.Types.ObjectId();

      await expect(eventsService.startEvent(fakeId.toString(), user._id.toString()))
        .rejects.toThrow('Event not found');
    });
  });

  describe('endEvent', () => {
    test('should transition event to ENDED state', async () => {
      const user = await createTestUser();
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.endEvent(event._id.toString(), user._id.toString());

      expect(result.state).toBe('ENDED');
      expect(result.endedAt).toBeDefined();
    });

    test('should throw Unauthorized for non-owner', async () => {
      const owner = await createTestUser();
      const otherUser = await createTestUser({ email: 'other@test.com' });
      
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: owner._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      await expect(eventsService.endEvent(event._id.toString(), otherUser._id.toString()))
        .rejects.toThrow('Unauthorized');
    });

    test('should throw NotFoundError when event not found', async () => {
      const user = await createTestUser();
      const fakeId = new mongoose.Types.ObjectId();

      await expect(eventsService.endEvent(fakeId.toString(), user._id.toString()))
        .rejects.toThrow('Event not found');
    });
  });

  describe('regenerateAccessCode', () => {
    test('should generate new access code for owner', async () => {
      const user = await createTestUser();
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: 'OLD123',
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.regenerateAccessCode(event._id.toString(), user._id.toString());

      expect(result.accessCode).not.toBe('OLD123');
    });

    test('should throw Unauthorized for non-owner', async () => {
      const owner = await createTestUser();
      const otherUser = await createTestUser({ email: 'other@test.com' });
      
      const event = await EventModel.create({
        name: 'Test Event',
        ownerId: owner._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: 'OLD123',
        state: 'LIVE',
        startsAt: new Date(),
      });

      await expect(eventsService.regenerateAccessCode(event._id.toString(), otherUser._id.toString()))
        .rejects.toThrow('Unauthorized');
    });
  });

  describe('getActiveEventForOwner', () => {
    test('should return active event for owner', async () => {
      const user = await createTestUser();
      
      await EventModel.create({
        name: 'Active Event',
        ownerId: user._id,
        eventId: `EVENT-${Date.now()}`,
        accessCode: `TEST${Date.now()}`,
        state: 'LIVE',
        startsAt: new Date(),
      });

      const result = await eventsService.getActiveEventForOwner(user._id.toString());

      expect(result).toBeDefined();
      expect(result.name).toBe('Active Event');
    });

    test('should throw when no active event', async () => {
      const user = await createTestUser();

      await expect(eventsService.getActiveEventForOwner(user._id.toString()))
        .rejects.toThrow('Event not found');
    });
  });
});
