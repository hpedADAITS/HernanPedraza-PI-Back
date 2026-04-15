const {
  generateEventCode,
  generateUniqueId,
  generateNonce,
} = require('../../src/utils/code-generator');

describe('Code Generator Utils', () => {
  describe('generateEventCode', () => {
    test('should generate code with default length of 6', () => {
      const code = generateEventCode();
      expect(code).toHaveLength(6);
    });

    test('should generate code with custom length', () => {
      expect(generateEventCode(4)).toHaveLength(4);
      expect(generateEventCode(8)).toHaveLength(8);
      expect(generateEventCode(10)).toHaveLength(10);
    });

    test('should only contain uppercase letters and numbers', () => {
      const code = generateEventCode(20);
      expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
    });

    test('should generate different codes on each call', () => {
      const code1 = generateEventCode();
      const code2 = generateEventCode();
      expect(code1).not.toBe(code2);
    });

    test('should throw error for length < 4', () => {
      expect(() => generateEventCode(3)).toThrow();
      expect(() => generateEventCode(0)).toThrow();
    });

    test('should throw error for length > 10', () => {
      expect(() => generateEventCode(11)).toThrow();
      expect(() => generateEventCode(100)).toThrow();
    });

    test('should throw error for invalid length', () => {
      expect(() => generateEventCode(-1)).toThrow();
      expect(() => generateEventCode(NaN)).toThrow();
    });
  });

  describe('generateUniqueId', () => {
    test('should generate a unique id', () => {
      const id = generateUniqueId();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    });

    test('should generate different ids on each call', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateUniqueId());
      }
      expect(ids.size).toBe(100); // All unique
    });

    test('should contain timestamp and random component', () => {
      const id = generateUniqueId();
      const parts = id.split('-');
      expect(parts).toHaveLength(2);
      expect(/^\d+$/.test(parts[0])).toBe(true); // timestamp is numeric
      expect(/^[a-z0-9]+$/.test(parts[1])).toBe(true); // random part is alphanumeric
    });

    test('should be compatible with sorting by generation time', () => {
      const id1 = generateUniqueId();
      const id2 = generateUniqueId();
      expect(id1 < id2).toBe(true);
    });
  });

  describe('generateNonce', () => {
    test('should generate nonce with default length of 16', () => {
      const nonce = generateNonce();
      expect(nonce).toHaveLength(16);
    });

    test('should generate nonce with custom length', () => {
      expect(generateNonce(8)).toHaveLength(8);
      expect(generateNonce(32)).toHaveLength(32);
      expect(generateNonce(64)).toHaveLength(64);
    });

    test('should contain alphanumeric characters', () => {
      const nonce = generateNonce(50);
      expect(/^[a-zA-Z0-9]+$/.test(nonce)).toBe(true);
    });

    test('should generate different nonces on each call', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    test('should generate cryptographically suitable nonce', () => {
      const nonces = new Set();
      for (let i = 0; i < 100; i++) {
        nonces.add(generateNonce());
      }
      expect(nonces.size).toBe(100); // All unique
    });

    test('should work with varying lengths', () => {
      for (let i = 1; i <= 50; i++) {
        const nonce = generateNonce(i);
        expect(nonce).toHaveLength(i);
      }
    });
  });
});
