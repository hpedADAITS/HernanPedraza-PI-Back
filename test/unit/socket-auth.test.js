/**
 * Unit tests for socket-auth.js
 * Tests double-authentication verification at socket level
 */

jest.mock('../../src/models/schema', () => ({
  EventModel: {
    findById: jest.fn(),
    prototype: { validateSync: jest.fn() },
  },
  EventMemberModel: {
    exists: jest.fn(),
    findOne: jest.fn(),
  },
  ParticipantModel: {
    findOne: jest.fn(),
  },
}));

const { EventModel, EventMemberModel, ParticipantModel } = require('../../src/models/schema');
const {
  assertEventRoomAccess,
  isSocketAuthOptional,
  socketActor,
  socketUserId,
} = require('../../src/socket/auth');

const eventId = '64b7f8f8f8f8f8f8f8f8f8f8';
const participantId = '64b7f8f8f8f8f8f8f8f8f8f9';

describe('socket-auth.js', () => {
  let mockSocket;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockSocket = {
      user: null,
    handshake: {
      headers: {},
    },
    io: {
      in: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    },
    join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    };
  });

  describe('socketUserId', () => {
    test('should extract userId from socket.user', () => {
      mockSocket.user = { userId: 'user-1' };
      expect(socketUserId(mockSocket)).toBe('user-1');
    });

    test('should extract userId from alternative fields', () => {
      mockSocket.user = { _id: 'user-2' };
      expect(socketUserId(mockSocket)).toBe('user-2');
    });

    test('should return undefined for no user', () => {
      mockSocket.user = null;
      expect(socketUserId(mockSocket)).toBeUndefined();
    });
  });

  describe('socketActor', () => {
    test('should return socket user when available', () => {
      mockSocket.user = { userId: 'user-1', role: 'DJ' };
      expect(socketActor(mockSocket)).toEqual({ userId: 'user-1', role: 'DJ' });
    });

    test('should return fallback when auth bypassed', () => {
      const oldEnv = process.env.SOCKET_AUTH_DISABLED;
      process.env.SOCKET_AUTH_DISABLED = 'true';
      
      mockSocket.user = null;
      const actor = socketActor(mockSocket, 'fallback-id');
      
      expect(actor).toBe('fallback-id');
      
      process.env.SOCKET_AUTH_DISABLED = oldEnv;
    });

    test('should return null without user and no bypass', () => {
      const oldEnv = process.env.SOCKET_AUTH_DISABLED;
      process.env.SOCKET_AUTH_DISABLED = 'false';
      
      mockSocket.user = null;
      expect(socketActor(mockSocket, 'fallback-id')).toBeNull();
      
      process.env.SOCKET_AUTH_DISABLED = oldEnv;
    });
  });

  describe('isSocketAuthOptional', () => {
    test('should return true in dev mode', () => {
      const oldEnv = process.env.SOCKET_AUTH_DISABLED;
      const oldNode = process.env.NODE_ENV;
      
      process.env.SOCKET_AUTH_DISABLED = 'true';
      process.env.NODE_ENV = 'development';
      
      expect(isSocketAuthOptional()).toBe(true);
      
      process.env.SOCKET_AUTH_DISABLED = oldEnv;
      process.env.NODE_ENV = oldNode;
    });

    test('should return false in production', () => {
      const oldEnv = process.env.SOCKET_AUTH_DISABLED;
      const oldNode = process.env.NODE_ENV;
      
      process.env.SOCKET_AUTH_DISABLED = 'true';
      process.env.NODE_ENV = 'production';
      
      expect(isSocketAuthOptional()).toBe(false);
      
      process.env.SOCKET_AUTH_DISABLED = oldEnv;
      process.env.NODE_ENV = oldNode;
    });

    test('should return false when not set', () => {
      const oldEnv = process.env.SOCKET_AUTH_DISABLED;
      process.env.SOCKET_AUTH_DISABLED = 'false';
      
      expect(isSocketAuthOptional()).toBe(false);
      
      process.env.SOCKET_AUTH_DISABLED = oldEnv;
    });
  });

  describe('assertEventRoomAccess', () => {
    test('should reject invalid event ID', async () => {
      mockSocket.user = { userId: 'user-1' };
      
      await expect(assertEventRoomAccess(mockSocket, 'invalid', 'p1'))
        .rejects.toThrow('Invalid event ID');
    });

    test('should allow owner access', async () => {
      mockSocket.user = { userId: 'owner-user', role: 'DJ' };
      
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'owner-user',
        }),
      });

      await expect(assertEventRoomAccess(mockSocket, eventId, null))
        .resolves.toBeNull();
    });

    test('should allow admin access', async () => {
      mockSocket.user = { userId: 'dj-user', role: 'DJ' };

      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'other-user',
        }),
      });

      EventMemberModel.exists.mockResolvedValue(true);

      const result = await assertEventRoomAccess(mockSocket, eventId, null);

      expect(result).toBeNull();
    });

    test('should check ownership via database', async () => {
      mockSocket.user = { userId: 'db-owner', role: 'DJ' };
      
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'db-owner',
        }),
      });

      await assertEventRoomAccess(mockSocket, eventId, null);
      
      expect(EventModel.findById).toHaveBeenCalledWith(eventId);
    });

    test('should check event membership via database', async () => {
      mockSocket.user = { userId: 'member-user', role: 'ATTENDEE' };
      
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'owner-user',
        }),
      });
      EventMemberModel.exists.mockResolvedValue({ _id: 'member-1' });

      const result = await assertEventRoomAccess(mockSocket, eventId, null);
      
      expect(result).toBeNull();
      expect(EventMemberModel.exists).toHaveBeenCalledWith({
        eventId,
        userId: 'member-user',
      });
    });

    test('should fallback to participant check', async () => {
      mockSocket.user = { userId: 'user-with-participant', role: 'ATTENDEE' };
      
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'owner-user',
        }),
      });
      EventMemberModel.exists.mockResolvedValue(null);
      
      ParticipantModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: participantId,
          eventId,
          userId: 'user-with-participant',
        }),
      });

      const result = await assertEventRoomAccess(
        mockSocket,
        eventId,
        participantId
      );
      
      expect(result).toBeDefined();
    });

    test('should reject unauthorized participant', async () => {
      mockSocket.user = { userId: 'user-1', role: 'ATTENDEE' };
      
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'other-owner',
        }),
      });
      EventMemberModel.exists.mockResolvedValue(null);
      ParticipantModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        assertEventRoomAccess(mockSocket, eventId, participantId)
      ).rejects.toThrow('cannot join this event');
    });

    test('should throw when participant access required but not provided', async () => {
      mockSocket.user = { userId: 'user-new', role: 'ATTENDEE' };
      
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'owner-user',
        }),
      });
      EventMemberModel.exists.mockResolvedValue(null);

      await expect(assertEventRoomAccess(mockSocket, eventId, null))
        .rejects.toThrow('Participant access is required');
    });

    test('should require participant ID for non-member', async () => {
      mockSocket.user = { userId: 'new-user', role: 'ATTENDEE' };
      
      EventModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: eventId,
          ownerId: 'owner-user',
        }),
      });
      EventMemberModel.exists.mockResolvedValue(null);
      ParticipantModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        assertEventRoomAccess(mockSocket, eventId, 'invalid-id')
      ).rejects.toThrow('Participant access is required');
    });
  });
});
