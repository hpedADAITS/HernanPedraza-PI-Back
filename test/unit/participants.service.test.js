/**
 * Unit tests for participantsService.js - UNMOCKED
 * Tests participant join, leave, update, admin actions, cooldowns, bans using REAL implementations
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  EventModel,
  ParticipantModel,
  UserModel,
} = require('../../src/models/schema');
const participantsService = require('../../src/services/participants.service');

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
    ParticipantModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

// Helper to create a real test event
const createTestEvent = async (overrides = {}) => {
  const user = await UserModel.create({
    email: `dj-${Date.now()}@test.com`,
    passwordHash: 'hashed',
    displayName: 'Test DJ',
    role: 'DJ',
    isActive: true,
  });

  const event = await EventModel.create({
    name: 'Test Event',
    ownerId: user._id,
    eventId: `EVENT-${Date.now()}`,
    accessCode: `TEST${Date.now()}`,
    state: 'LIVE',
    startsAt: new Date(),
    ...overrides,
  });

  return { event, user };
};

// Helper to create a real participant
const createTestParticipant = async (eventId, overrides = {}) => {
  const nickname = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const userEmail = `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@test.com`;
  const user = await UserModel.create({
    email: userEmail,
    passwordHash: 'hashed',
    displayName: nickname,
    role: 'ATTENDEE',
    isActive: true,
  });
  
  const participant = await ParticipantModel.create({
    eventId,
    nickname,
    isBanned: false,
    leftAt: null,
    userId: user._id,
    ...overrides,
  });
  
  participant.userId = user._id;
  await participant.save();
  
  return participant;
};

describe('ParticipantsService - Real Implementation Tests', () => {
  describe('ensureNicknameIsNotAccessCode', () => {
    test('should throw when nickname matches event access code', async () => {
      const { event } = await createTestEvent();

      await expect(participantsService.ensureNicknameIsNotAccessCode(event.accessCode))
        .rejects.toThrow('Nickname cannot be a valid access code');
    });

    test('should allow non-matching nicknames', async () => {
      await expect(participantsService.ensureNicknameIsNotAccessCode('DanceParty'))
        .resolves.toBeUndefined();
    });
  });

  describe('kickParticipant', () => {
    test('should kick participant and set reason', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const adminUser = await UserModel.create({
        email: `admin-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        displayName: 'Admin',
        role: 'DJ',
        isActive: true,
      });

      const result = await participantsService.kickParticipant(
        participant._id.toString(),
        'Violation of rules',
        { userId: adminUser._id.toString(), role: 'DJ' }
      );

      expect(result.action).toBe('participant_kicked');
      
      // Verify participant was updated
      const updatedParticipant = await ParticipantModel.findById(participant._id);
      expect(updatedParticipant.kickedAt).toBeDefined();
      expect(updatedParticipant.kickedBy.toString()).toBe(adminUser._id.toString());
    });

    test('should throw NotFoundError when participant not found', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(participantsService.kickParticipant(fakeId.toString(), 'reason', {}))
        .rejects.toThrow('Participant not found');
    });
  });

  describe('banParticipant', () => {
    test('should ban participant permanently', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const adminUser = await UserModel.create({
        email: `admin-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        displayName: 'Admin',
        role: 'DJ',
        isActive: true,
      });

      const result = await participantsService.banParticipant(
        participant._id.toString(),
        'Repeated violations',
        { userId: adminUser._id.toString(), role: 'DJ' }
      );

      expect(result.action).toBe('participant_banned');
      
      // Verify participant was banned
      const updatedParticipant = await ParticipantModel.findById(participant._id);
      expect(updatedParticipant.isBanned).toBe(true);
      expect(updatedParticipant.bannedAt).toBeDefined();
      expect(updatedParticipant.banReason).toBe('Repeated violations');
    });
  });

  describe('setParticipantCooldown', () => {
    test('should set cooldown period', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const adminUser = await UserModel.create({
        email: `admin-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        displayName: 'Admin',
        role: 'DJ',
        isActive: true,
      });

      const result = await participantsService.setParticipantCooldown(
        participant._id.toString(),
        3600000, // 1 hour
        'Spam',
        { userId: adminUser._id.toString(), role: 'DJ' }
      );

      expect(result.action).toBe('participant_cooldown');
      
      // Verify participant was updated
      const updatedParticipant = await ParticipantModel.findById(participant._id);
      expect(updatedParticipant.cooldownUntil).toBeDefined();
      expect(updatedParticipant.cooldownReason).toBe('Spam');
    });
  });

  describe('ensureParticipantCanInteract', () => {
    test('should allow active participant', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      const result = await participantsService.ensureParticipantCanInteract(
        participant._id.toString(),
        event._id.toString()
      );

      expect(result).toBeDefined();
    });

    test('should throw for banned participant', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { isBanned: true });

      await expect(participantsService.ensureParticipantCanInteract(participant._id.toString(), event._id.toString()))
        .rejects.toThrow('has been banned');
    });

    test('should throw for left participant', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { leftAt: new Date() });

      await expect(participantsService.ensureParticipantCanInteract(participant._id.toString(), event._id.toString()))
        .rejects.toThrow('no longer active');
    });

    test('should throw for kicked participant', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { 
        leftAt: new Date(),
        kickedAt: new Date(),
      });

      await expect(participantsService.ensureParticipantCanInteract(participant._id.toString(), event._id.toString()))
        .rejects.toThrow('was kicked');
    });

    test('should throw when on cooldown', async () => {
      const futureTime = new Date(Date.now() + 3600000);
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { 
        cooldownUntil: futureTime,
        cooldownReason: 'Spamming',
      });

      await expect(participantsService.ensureParticipantCanInteract(
        participant._id.toString(),
        event._id.toString(),
        { checkCooldown: true }
      )).rejects.toThrow('on cooldown');
    });

    test('should clear expired cooldown', async () => {
      const pastTime = new Date(Date.now() - 3600000);
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { 
        cooldownUntil: pastTime,
        cooldownReason: 'Old',
      });

      await participantsService.ensureParticipantCanInteract(
        participant._id.toString(),
        event._id.toString(),
        { checkCooldown: false }
      );

      // Verify cooldown was cleared
      const updatedParticipant = await ParticipantModel.findById(participant._id);
      expect(updatedParticipant.cooldownUntil).toBeUndefined();
    });
  });

  describe('setPremium', () => {
    test('should set premium status', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id, { isPremium: false });
      const adminUser = await UserModel.create({
        email: `admin-${Date.now()}@test.com`,
        passwordHash: 'hashed',
        displayName: 'Admin',
        role: 'DJ',
        isActive: true,
      });

      const result = await participantsService.setPremium(
        participant._id.toString(),
        true,
        { userId: adminUser._id.toString(), role: 'DJ' }
      );

      // Verify premium was set
      const updatedParticipant = await ParticipantModel.findById(participant._id);
      expect(updatedParticipant.isPremium).toBe(true);
    });
  });

  describe('_formatParticipant', () => {
    test('should format participant with cooldown detection', () => {
      const futureTime = new Date(Date.now() + 3600000);
      const mockParticipant = {
        _id: { toString: () => 'participant-1' },
        userId: { toString: () => 'user-1' },
        eventId: 'event-1',
        nickname: 'TestUser',
        profilePicture: null,
        socketId: null,
        joinedAt: new Date(),
        lastSeenAt: new Date(),
        isBanned: false,
        cooldownUntil: futureTime,
        cooldownReason: 'Test',
        isPremium: true,
        passwordHash: null,
        passwordSetAt: null,
        leftAt: null,
      };

      const result = participantsService._formatParticipant(mockParticipant);

      expect(result.cooldownUntil).not.toBeNull();
      expect(result.cooldownReason).not.toBeNull();
      expect(result.isPremium).toBe(true);
    });
  });
});
