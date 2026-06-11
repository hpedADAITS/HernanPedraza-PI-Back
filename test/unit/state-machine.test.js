/**
 * test/unit/state-machine.test.js
 *
 * Comprehensive tests for Song State Machine
 * Validates all state transitions
 */

const { validateTransition } = require('../../src/utils/song-state-machine');

describe('Song State Machine', () => {
  describe('Valid Transitions', () => {
    test('should allow PENDING -> APPROVED', () => {
      expect(() => validateTransition('PENDING', 'APPROVED', 'DJ')).not.toThrow();
    });

    test('should allow PENDING -> REJECTED', () => {
      expect(() => validateTransition('PENDING', 'REJECTED', 'DJ')).not.toThrow();
    });

    test('should allow APPROVED -> PLAYING', () => {
      expect(() => validateTransition('APPROVED', 'PLAYING', 'DJ')).not.toThrow();
    });

    test('should allow APPROVED -> REJECTED', () => {
      expect(() => validateTransition('APPROVED', 'REJECTED', 'DJ')).not.toThrow();
    });

    test('should allow PLAYING -> PLAYED', () => {
      expect(() => validateTransition('PLAYING', 'PLAYED', 'DJ')).not.toThrow();
    });

    test('should allow PLAYING -> SKIPPED', () => {
      expect(() => validateTransition('PLAYING', 'SKIPPED', 'DJ')).not.toThrow();
    });
  });

  describe('Invalid Transitions', () => {
    test('should reject PLAYED -> any state (terminal)', () => {
      expect(() => validateTransition('PLAYED', 'APPROVED', 'DJ')).toThrow();
      expect(() => validateTransition('PLAYED', 'PENDING', 'DJ')).toThrow();
      expect(() => validateTransition('PLAYED', 'PLAYING', 'DJ')).toThrow();
    });

    test('should reject SKIPPED -> any state (terminal)', () => {
      expect(() => validateTransition('SKIPPED', 'APPROVED', 'DJ')).toThrow();
      expect(() => validateTransition('SKIPPED', 'PENDING', 'DJ')).toThrow();
    });

    test('should reject REJECTED -> any state (terminal)', () => {
      expect(() => validateTransition('REJECTED', 'APPROVED', 'DJ')).toThrow();
      expect(() => validateTransition('REJECTED', 'PENDING', 'DJ')).toThrow();
    });

    test('should reject PENDING -> PLAYING (skip APPROVED)', () => {
      expect(() => validateTransition('PENDING', 'PLAYING', 'DJ')).toThrow();
    });

    test('should reject APPROVED -> PENDING (backward)', () => {
      expect(() => validateTransition('APPROVED', 'PENDING', 'DJ')).toThrow();
    });

    test('should reject PENDING -> SKIPPED (skip intermediate states)', () => {
      expect(() => validateTransition('PENDING', 'SKIPPED', 'DJ')).toThrow();
    });

    test('should reject invalid source state', () => {
      expect(() => validateTransition('INVALID', 'APPROVED', 'DJ')).toThrow();
    });

    test('should reject invalid target state', () => {
      expect(() => validateTransition('PENDING', 'INVALID', 'DJ')).toThrow();
    });
  });

  describe('State Machine Graph', () => {
    test('should represent valid state flow', () => {
      const flow = [
        ['PENDING', 'APPROVED'],
        ['APPROVED', 'PLAYING'],
        ['PLAYING', 'PLAYED'],
      ];

      flow.forEach(([from, to]) => {
        expect(() => validateTransition(from, to, 'DJ')).not.toThrow();
      });
    });

    test('should reject cyclic transitions', () => {
      expect(() => validateTransition('PENDING', 'PENDING', 'DJ')).toThrow();
      expect(() => validateTransition('APPROVED', 'APPROVED', 'DJ')).toThrow();
    });

    test('should allow multiple paths for rejection', () => {
      // PENDING can be rejected directly
      expect(() => validateTransition('PENDING', 'REJECTED', 'DJ')).not.toThrow();

      // APPROVED can be rejected
      expect(() => validateTransition('APPROVED', 'REJECTED', 'DJ')).not.toThrow();
    });
  });

  describe('Role-Based Transitions', () => {
    test('should validate DJ role for all transitions', () => {
      const transitions = [
        ['PENDING', 'APPROVED'],
        ['APPROVED', 'PLAYING'],
        ['PLAYING', 'PLAYED'],
      ];

      transitions.forEach(([from, to]) => {
        expect(() => validateTransition(from, to, 'DJ')).not.toThrow();
      });
    });

    test('should reject unknown role', () => {
      expect(() => validateTransition('PENDING', 'APPROVED', 'UNKNOWN')).toThrow();
    });
  });

  describe('Edge Cases', () => {
    test('should handle null states', () => {
      expect(() => validateTransition(null, 'APPROVED', 'DJ')).toThrow();
      expect(() => validateTransition('PENDING', null, 'DJ')).toThrow();
    });

    test('should handle undefined states', () => {
      expect(() => validateTransition(undefined, 'APPROVED', 'DJ')).toThrow();
      expect(() => validateTransition('PENDING', undefined, 'DJ')).toThrow();
    });

    test('should handle case sensitivity', () => {
      // Assuming lowercase states in DB
      expect(() => validateTransition('pending', 'APPROVED', 'DJ')).toThrow();
      expect(() => validateTransition('PENDING', 'approved', 'DJ')).toThrow();
    });

    test('should handle empty strings', () => {
      expect(() => validateTransition('', 'APPROVED', 'DJ')).toThrow();
      expect(() => validateTransition('PENDING', '', 'DJ')).toThrow();
    });
  });

  describe('Complete State Paths', () => {
    test('happy path: PENDING -> APPROVED -> PLAYING -> PLAYED', () => {
      const path = ['PENDING', 'APPROVED', 'PLAYING', 'PLAYED'];

      for (let i = 0; i < path.length - 1; i++) {
        expect(() => validateTransition(path[i], path[i + 1], 'DJ')).not.toThrow();
      }
    });

    test('rejection path: PENDING -> REJECTED', () => {
      expect(() => validateTransition('PENDING', 'REJECTED', 'DJ')).not.toThrow();
    });

    test('early rejection: APPROVED -> REJECTED', () => {
      expect(() => validateTransition('APPROVED', 'REJECTED', 'DJ')).not.toThrow();
    });

    test('skip path: PENDING -> APPROVED -> PLAYING -> SKIPPED', () => {
      const path = ['PENDING', 'APPROVED', 'PLAYING', 'SKIPPED'];

      for (let i = 0; i < path.length - 1; i++) {
        expect(() => validateTransition(path[i], path[i + 1], 'DJ')).not.toThrow();
      }
    });
  });

  describe('Error Messages', () => {
    test('should provide helpful error for invalid transition', () => {
      try {
        validateTransition('PLAYED', 'APPROVED', 'DJ');
        fail('Should have thrown');
      } catch (error) {
        expect(error.message).toContain('PLAYED');
        expect(error.message).toContain('APPROVED');
      }
    });

    test('should mention terminal state in error', () => {
      try {
        validateTransition('PLAYED', 'PENDING', 'DJ');
        fail('Should have thrown');
      } catch (error) {
        expect(error.message.toLowerCase()).toContain('terminal');
      }
    });
  });
});
