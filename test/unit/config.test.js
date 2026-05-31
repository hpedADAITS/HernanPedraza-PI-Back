describe('config', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function loadConfig() {
    return require('../../src/config');
  }

  test('uses a local jwt secret outside production when JWT_SECRET is missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;

    const config = loadConfig();

    expect(config.jwtSecret).toBe('syncrekuest-local-development-secret');
  });

  test('fails production startup when JWT_SECRET is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => loadConfig()).toThrow(
      'JWT_SECRET is required in production',
    );
  });

  test('fails production startup when DEBUG_MODE is enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-with-enough-entropy';
    process.env.DEBUG_MODE = 'true';

    expect(() => loadConfig()).toThrow(
      'DEBUG_MODE cannot be enabled in production',
    );
  });

  test('fails production startup when JWT_SECRET is too short', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short-secret';

    expect(() => loadConfig()).toThrow(
      'JWT_SECRET must be at least 32 characters in production',
    );
  });

  test('accepts a strong production JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'production-secret-with-enough-entropy';

    const config = loadConfig();

    expect(config.jwtSecret).toBe('production-secret-with-enough-entropy');
  });
});
