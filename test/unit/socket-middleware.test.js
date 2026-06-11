/**
 * Unit tests for socket-middleware.js
 * Tests Socket.IO token validation middleware
 */

jest.mock('../../src/services/auth.service', () => ({
  validateDefaultToken: jest.fn(),
}));

jest.mock('../../src/utils', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/utils/jwt.utils', () => ({
  verifyToken: jest.fn(),
}));

const { authService } = require('../../src/services');
const { verifyToken } = require('../../src/utils/jwt.utils');
const { socketAuthMiddleware, requireFields } = require('../../src/socket/middleware');

describe('socketAuthMiddleware', () => {
  let mockSocket;
  let mockNext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSocket = {
      handshake: {
        headers: {},
        auth: {},
        query: {},
      },
      user: null,
      token: null,
    };

    mockNext = jest.fn();
  });

  test('should reject request without token', async () => {
    await socketAuthMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(new Error('UNAUTHORIZED: missing token'));
  });

  test('should reject request with empty token', async () => {
    mockSocket.handshake.auth.token = '';

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(new Error('UNAUTHORIZED: missing token'));
  });

  test('should accept token from auth object', async () => {
    mockSocket.handshake.auth.token = 'valid-token';

    authService.validateDefaultToken.mockResolvedValue({
      decoded: { userId: 'user-1', role: 'DJ' },
      user: { role: 'DJ' },
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
    expect(mockSocket.user).toEqual(expect.objectContaining({
      userId: 'user-1',
      role: 'DJ',
    }));
  });

  test('should accept token from query params', async () => {
    mockSocket.handshake.query.token = 'valid-token';

    authService.validateDefaultToken.mockResolvedValue({
      decoded: { userId: 'user-2', role: 'ATTENDEE' },
      user: { role: 'ATTENDEE' },
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(authService.validateDefaultToken).toHaveBeenCalledWith('valid-token');
    expect(mockNext).toHaveBeenCalledWith();
  });

  test('should accept token from Authorization header', async () => {
    mockSocket.handshake.headers.authorization = 'Bearer header-token';

    authService.validateDefaultToken.mockResolvedValue({
      decoded: { userId: 'user-3', role: 'DJ' },
      user: { role: 'DJ' },
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(authService.validateDefaultToken).toHaveBeenCalledWith('header-token');
  });

  test('should prioritize auth token over other sources', async () => {
    mockSocket.handshake.auth.token = 'auth-token';
    mockSocket.handshake.query.token = 'query-token';
    mockSocket.handshake.headers.authorization = 'Bearer header-token';

    authService.validateDefaultToken.mockResolvedValue({
      decoded: { userId: 'user-1', role: 'DJ' },
      user: { role: 'DJ' },
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(authService.validateDefaultToken).toHaveBeenCalledWith('auth-token');
  });

  test('should fall back to phone-microphone token', async () => {
    mockSocket.handshake.auth.token = 'phone-token';

    authService.validateDefaultToken.mockRejectedValue(new Error('Invalid'));
    verifyToken.mockReturnValue({
      userId: 'phone-1',
      type: 'phone-microphone',
      role: 'DJ',
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
    expect(mockSocket.user.role).toBe('DJ');
  });

  test('should reject invalid fallback token type', async () => {
    mockSocket.handshake.auth.token = 'invalid-token';

    authService.validateDefaultToken.mockRejectedValue(new Error('Invalid'));
    verifyToken.mockReturnValue({
      userId: 'user-1',
      type: 'other-type',
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(new Error('UNAUTHORIZED: invalid token'));
  });

  test('should attach token to socket object', async () => {
    mockSocket.handshake.auth.token = 'my-token';

    authService.validateDefaultToken.mockResolvedValue({
      decoded: { userId: 'user-1', role: 'DJ' },
      user: { role: 'DJ' },
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(mockSocket.token).toBe('my-token');
  });

  test('should convert userId to string', async () => {
    mockSocket.handshake.auth.token = 'valid-token';

    authService.validateDefaultToken.mockResolvedValue({
      decoded: { userId: 'user-1', role: 'DJ' },
      user: { role: 'DJ' },
    });

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(typeof mockSocket.user.userId).toBe('string');
  });

  test('should log auth failures', async () => {
    const { logger } = require('../../src/utils');

    mockSocket.handshake.auth.token = 'bad-token';

    authService.validateDefaultToken.mockRejectedValue(new Error('Failed'));

    await socketAuthMiddleware(mockSocket, mockNext);

    expect(logger.error).toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledWith(new Error('UNAUTHORIZED: invalid token'));
  });
});

describe('requireFields', () => {
  test('should return null for valid data', () => {
    const result = requireFields({ a: 1, b: 2 }, ['a', 'b']);
    expect(result).toBeNull();
  });

  test('should return error for missing field', () => {
    const result = requireFields({ a: 1 }, ['a', 'b']);
    expect(result).toBe('missing field: b');
  });

  test('should return error for null field', () => {
    const result = requireFields({ a: 1, b: null }, ['a', 'b']);
    expect(result).toBe('missing field: b');
  });

  test('should return error for empty string field', () => {
    const result = requireFields({ a: '', b: 2 }, ['a', 'b']);
    expect(result).toBe('missing field: a');
  });

  test('should return error for undefined data', () => {
    const result = requireFields(undefined, ['a']);
    expect(result).toBe('payload must be object');
  });

  test('should return error for null data', () => {
    const result = requireFields(null, ['a']);
    expect(result).toBe('payload must be object');
  });
});
