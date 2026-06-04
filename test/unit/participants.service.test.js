/**
 * Unit tests for participantsService.js
 * Tests participant join, leave, update, admin actions, cooldowns, bans
 */

// Create mock functions first
const mockSelect = jest.fn().mockReturnThis();
const mockSession = jest.fn().mockReturnThis();
const mockSort = jest.fn().mockResolvedValue([]);

jest.mock('../../src/models/schema', () => ({
  EventModel: {
    exists: jest.fn().mockResolvedValue(false),
    findById: jest.fn().mockResolvedValue(null),
  },
  ParticipantModel: {
    findOne: jest.fn().mockReturnValue({
      select: mockSelect,
      session: mockSession,
    }),
    findById: jest.fn().mockResolvedValue(null),
    countDocuments: jest.fn().mockResolvedValue(0),
    findByIdAndUpdate: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({
      sort: mockSort,
    }),
  },
  UserModel: {
    findById: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../src/services/event-permissions.service', () => ({
  assertParticipantAdmin: jest.fn().mockResolvedValue('admin-user-id'),
}));

jest.mock('../../src/utils', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

const bcrypt = require('bcryptjs');
const { EventModel, ParticipantModel } = require('../../src/models/schema');
const eventPermissionsService = require('../../src/services/event-permissions.service');
const participantsService = require('../../src/services/participants.service');

describe('ParticipantsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('ensureNicknameIsNotAccessCode', () => {
    test('should throw when nickname matches event access code', async () => {
      EventModel.exists.mockResolvedValue(true);

      await expect(participantsService.ensureNicknameIsNotAccessCode('ABCD12'))
        .rejects.toThrow('Nickname cannot be a valid access code');
    });

    test('should allow non-matching nicknames', async () => {
      EventModel.exists.mockResolvedValue(false);

      await expect(participantsService.ensureNicknameIsNotAccessCode('DanceParty'))
        .resolves.toBeUndefined();
    });
  });

  describe('kickParticipant', () => {
    test('should kick participant and set reason', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        eventId: 'event-1',
        userId: 'victim-user',
        kickedAt: null,
        kickedBy: null,
        kickReason: null,
        leftAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);
      eventPermissionsService.assertParticipantAdmin.mockResolvedValue('admin-user');

      const result = await participantsService.kickParticipant(
        'participant-1',
        'Violation of rules',
        { userId: 'admin-user', role: 'DJ' }
      );

      expect(mockParticipant.kickedAt).toBeInstanceOf(Date);
      expect(mockParticipant.kickedBy).toBe('admin-user');
      expect(result.action).toBe('participant_kicked');
    });

    test('should throw NotFoundError when participant not found', async () => {
      ParticipantModel.findById.mockResolvedValue(null);

      await expect(participantsService.kickParticipant('invalid-id', 'reason', {}))
        .rejects.toThrow('Participant not found');
    });
  });

  describe('banParticipant', () => {
    test('should ban participant permanently', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        eventId: 'event-1',
        bannedAt: null,
        bannedBy: null,
        banReason: null,
        isBanned: false,
        leftAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);
      eventPermissionsService.assertParticipantAdmin.mockResolvedValue('admin-user');

      const result = await participantsService.banParticipant(
        'participant-1',
        'Repeated violations',
        { userId: 'admin-user', role: 'DJ' }
      );

      expect(mockParticipant.isBanned).toBe(true);
      expect(mockParticipant.bannedAt).toBeInstanceOf(Date);
      expect(result.action).toBe('participant_banned');
    });
  });

  describe('setParticipantCooldown', () => {
    test('should set cooldown period', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        eventId: 'event-1',
        cooldownUntil: null,
        cooldownReason: null,
        save: jest.fn().mockResolvedValue(true),
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);
      eventPermissionsService.assertParticipantAdmin.mockResolvedValue('admin-user');

      const result = await participantsService.setParticipantCooldown(
        'participant-1',
        3600000, // 1 hour
        'Spam',
        { userId: 'admin-user', role: 'DJ' }
      );

      expect(mockParticipant.cooldownUntil).toBeInstanceOf(Date);
      expect(mockParticipant.cooldownReason).toBe('Spam');
      expect(result.action).toBe('participant_cooldown');
    });
  });

  describe('ensureParticipantCanInteract', () => {
    test('should allow active participant', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        eventId: { toString: () => 'event-1' },
        isBanned: false,
        leftAt: null,
        cooldownUntil: null,
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);

      const result = await participantsService.ensureParticipantCanInteract(
        'participant-1',
        'event-1'
      );

      expect(result).toBeDefined();
    });

    test('should throw for banned participant', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        eventId: { toString: () => 'event-1' },
        isBanned: true,
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);

      await expect(participantsService.ensureParticipantCanInteract('participant-1', 'event-1'))
        .rejects.toThrow('has been banned');
    });

    test('should throw for left participant', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        eventId: { toString: () => 'event-1' },
        isBanned: false,
        leftAt: new Date(),
        kickedAt: null,
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);

      await expect(participantsService.ensureParticipantCanInteract('participant-1', 'event-1'))
        .rejects.toThrow('no longer active');
    });

    test('should throw for kicked participant', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        eventId: { toString: () => 'event-1' },
        isBanned: false,
        leftAt: new Date(),
        kickedAt: new Date(),
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);

      await expect(participantsService.ensureParticipantCanInteract('participant-1', 'event-1'))
        .rejects.toThrow('was kicked');
    });

    test('should throw when on cooldown', async () => {
      const futureTime = new Date(Date.now() + 3600000);
      const mockParticipant = {
        _id: 'participant-1',
        eventId: { toString: () => 'event-1' },
        isBanned: false,
        leftAt: null,
        cooldownUntil: futureTime,
        cooldownReason: 'Spamming',
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);

      await expect(participantsService.ensureParticipantCanInteract(
        'participant-1',
        'event-1',
        { checkCooldown: true }
      )).rejects.toThrow('on cooldown');
    });

    test('should clear expired cooldown', async () => {
      const pastTime = new Date(Date.now() - 3600000);
      const mockParticipant = {
        _id: 'participant-1',
        eventId: { toString: () => 'event-1' },
        isBanned: false,
        leftAt: null,
        cooldownUntil: pastTime,
        cooldownReason: 'Old',
        save: jest.fn().mockResolvedValue(true),
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);

      await participantsService.ensureParticipantCanInteract(
        'participant-1',
        'event-1',
        { checkCooldown: false }
      );

      expect(mockParticipant.save).toHaveBeenCalled();
    });
  });

  describe('setPremium', () => {
    test('should set premium status', async () => {
      const mockParticipant = {
        _id: 'participant-1',
        isPremium: false,
        save: jest.fn().mockResolvedValue(true),
      };

      ParticipantModel.findById.mockResolvedValue(mockParticipant);

      const result = await participantsService.setPremium(
        'participant-1',
        true,
        { userId: 'admin', role: 'DJ' }
      );

      expect(mockParticipant.isPremium).toBe(true);
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