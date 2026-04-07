const {
  ApiError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} = require('../../src/errors');

describe('Custom Error Classes', () => {
  describe('ApiError', () => {
    test('should create error with default status code 500', () => {
      const error = new ApiError('Server error');
      expect(error.message).toBe('Server error');
      expect(error.statusCode).toBe(500);
      expect(error instanceof Error).toBe(true);
    });

    test('should create error with custom status code', () => {
      const error = new ApiError('Not Found', 404);
      expect(error.message).toBe('Not Found');
      expect(error.statusCode).toBe(404);
    });

    test('should preserve stack trace', () => {
      const error = new ApiError('Test error');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ApiError');
    });

    test('should be instance of Error', () => {
      const error = new ApiError('Test');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof ApiError).toBe(true);
    });
  });

  describe('ValidationError', () => {
    test('should create validation error with status 400', () => {
      const error = new ValidationError('Invalid input');
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
    });

    test('should be instance of ApiError', () => {
      const error = new ValidationError('Test');
      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof ValidationError).toBe(true);
    });
  });

  describe('UnauthorizedError', () => {
    test('should create unauthorized error with status 401', () => {
      const error = new UnauthorizedError('Not authenticated');
      expect(error.message).toBe('Not authenticated');
      expect(error.statusCode).toBe(401);
    });

    test('should be instance of ApiError', () => {
      const error = new UnauthorizedError('Test');
      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof UnauthorizedError).toBe(true);
    });
  });

  describe('NotFoundError', () => {
    test('should create not found error with status 404', () => {
      const error = new NotFoundError('Resource not found');
      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
    });

    test('should be instance of ApiError', () => {
      const error = new NotFoundError('Test');
      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof NotFoundError).toBe(true);
    });
  });

  describe('ForbiddenError', () => {
    test('should create forbidden error with status 403', () => {
      const error = new ForbiddenError('Access denied');
      expect(error.message).toBe('Access denied');
      expect(error.statusCode).toBe(403);
    });

    test('should be instance of ApiError', () => {
      const error = new ForbiddenError('Test');
      expect(error instanceof ApiError).toBe(true);
      expect(error instanceof ForbiddenError).toBe(true);
    });
  });
});
