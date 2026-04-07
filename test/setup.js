// test/setup.js
/**
 * Global test setup
 * Configures environment and initializes test utilities
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
process.env.JWT_EXPIRY = '1h';

// Suppress logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test utilities
global.testUtils = {
  /**
   * Create a mock user object
   */
  createMockUser: (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439011',
    email: 'test@example.com',
    displayName: 'Test User',
    role: 'ATTENDEE',
    ...overrides,
  }),

  /**
   * Create a mock event object
   */
  createMockEvent: (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439012',
    name: 'Test Event',
    code: 'ABCDEF',
    eventManager: '507f1f77bcf86cd799439011',
    currentDJ: null,
    isActive: true,
    participants: [],
    songs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  /**
   * Create a mock song object
   */
  createMockSong: (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439013',
    title: 'Test Song',
    artist: 'Test Artist',
    event: '507f1f77bcf86cd799439012',
    requestedBy: '507f1f77bcf86cd799439011',
    votes: [],
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),
};
