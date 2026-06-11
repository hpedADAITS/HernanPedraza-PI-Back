/**
 * test/unit/cooldown-cache.test.js
 *
 * Comprehensive tests for in-memory cooldown cache
 */

const cooldownCache = require('../../src/utils/cooldown-cache');

describe('Cooldown Cache', () => {
  beforeEach(() => {
    cooldownCache.clearAll();
  });

  afterEach(() => {
    cooldownCache.clearAll();
  });

  /* ============ SET COOLDOWN ============ */

  describe('setCooldown', () => {
    test('should set cooldown for participant', () => {
      const eventId = 'event1';
      const participantId = 'user1';

      cooldownCache.setCooldown(eventId, participantId, 5000, 'Spam prevention');

      expect(cooldownCache.isOnCooldown(eventId, participantId)).toBe(true);
    });

    test('should set multiple cooldowns for different participants', () => {
      const eventId = 'event1';

      cooldownCache.setCooldown(eventId, 'user1', 5000, 'Spam');
      cooldownCache.setCooldown(eventId, 'user2', 5000, 'Spam');
      cooldownCache.setCooldown(eventId, 'user3', 5000, 'Spam');

      expect(cooldownCache.isOnCooldown(eventId, 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown(eventId, 'user2')).toBe(true);
      expect(cooldownCache.isOnCooldown(eventId, 'user3')).toBe(true);
    });

    test('should set cooldowns for different events independently', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      cooldownCache.setCooldown('event2', 'user1', 5000, 'Spam');

      // Same user on cooldown in both events
      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown('event2', 'user1')).toBe(true);
    });

    test('should update existing cooldown duration', () => {
      const eventId = 'event1';
      const participantId = 'user1';

      // Set 5 second cooldown
      cooldownCache.setCooldown(eventId, participantId, 5000, 'First');

      const cooldown1 = cooldownCache.getCooldown(eventId, participantId);
      const expiresAt1 = cooldown1.expiresAt;

      // Update with 10 second cooldown
      cooldownCache.setCooldown(eventId, participantId, 10000, 'Updated');

      const cooldown2 = cooldownCache.getCooldown(eventId, participantId);
      const expiresAt2 = cooldown2.expiresAt;

      expect(expiresAt2).toBeGreaterThan(expiresAt1);
    });

    test('should update reason when setting new cooldown', () => {
      const eventId = 'event1';
      const participantId = 'user1';

      cooldownCache.setCooldown(eventId, participantId, 5000, 'Original reason');
      let cooldown = cooldownCache.getCooldown(eventId, participantId);
      expect(cooldown.reason).toBe('Original reason');

      cooldownCache.setCooldown(eventId, participantId, 5000, 'New reason');
      cooldown = cooldownCache.getCooldown(eventId, participantId);
      expect(cooldown.reason).toBe('New reason');
    });
  });

  /* ============ IS ON COOLDOWN ============ */

  describe('isOnCooldown', () => {
    test('should return true when on cooldown', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
    });

    test('should return false when not on cooldown', () => {
      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
    });

    test('should return false for expired cooldown', (done) => {
      cooldownCache.setCooldown('event1', 'user1', 100, 'Short cooldown');
      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);

      setTimeout(() => {
        expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
        done();
      }, 150);
    });

    test('should return false for different event', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown('event2', 'user1')).toBe(false);
    });

    test('should return false for different participant', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown('event1', 'user2')).toBe(false);
    });
  });

  /* ============ GET COOLDOWN ============ */

  describe('getCooldown', () => {
    test('should return cooldown entry with expiresAt timestamp', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');

      const cooldown = cooldownCache.getCooldown('event1', 'user1');

      expect(cooldown).toBeDefined();
      expect(cooldown.reason).toBe('Spam');
      expect(cooldown.expiresAt).toBeDefined();
      expect(typeof cooldown.expiresAt).toBe('number');
    });

    test('should return null for non-existent cooldown', () => {
      const cooldown = cooldownCache.getCooldown('event1', 'user1');
      expect(cooldown).toBeNull();
    });

    test('should return correct expiry time', () => {
      const now = Date.now();
      const duration = 5000;

      cooldownCache.setCooldown('event1', 'user1', duration, 'Test');

      const cooldown = cooldownCache.getCooldown('event1', 'user1');

      expect(cooldown.expiresAt).toBeGreaterThanOrEqual(now + duration);
      expect(cooldown.expiresAt).toBeLessThanOrEqual(now + duration + 100);
    });
  });

  /* ============ CLEAR COOLDOWN ============ */

  describe('clearCooldown', () => {
    test('should remove cooldown for participant', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);

      cooldownCache.clearCooldown('event1', 'user1');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
    });

    test('should not affect other participants in same event', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      cooldownCache.setCooldown('event1', 'user2', 5000, 'Spam');

      cooldownCache.clearCooldown('event1', 'user1');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
      expect(cooldownCache.isOnCooldown('event1', 'user2')).toBe(true);
    });

    test('should not affect same user in different event', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      cooldownCache.setCooldown('event2', 'user1', 5000, 'Spam');

      cooldownCache.clearCooldown('event1', 'user1');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
      expect(cooldownCache.isOnCooldown('event2', 'user1')).toBe(true);
    });

    test('should do nothing when clearing non-existent cooldown', () => {
      expect(() => {
        cooldownCache.clearCooldown('event1', 'user1');
      }).not.toThrow();
    });
  });

  /* ============ CLEAR EVENT COOLDOWNS ============ */

  describe('clearEventCooldowns', () => {
    test('should clear all cooldowns for event', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      cooldownCache.setCooldown('event1', 'user2', 5000, 'Spam');
      cooldownCache.setCooldown('event1', 'user3', 5000, 'Spam');

      cooldownCache.clearEventCooldowns('event1');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
      expect(cooldownCache.isOnCooldown('event1', 'user2')).toBe(false);
      expect(cooldownCache.isOnCooldown('event1', 'user3')).toBe(false);
    });

    test('should not affect other events', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      cooldownCache.setCooldown('event2', 'user1', 5000, 'Spam');
      cooldownCache.setCooldown('event2', 'user2', 5000, 'Spam');

      cooldownCache.clearEventCooldowns('event1');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
      expect(cooldownCache.isOnCooldown('event2', 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown('event2', 'user2')).toBe(true);
    });
  });

  /* ============ CLEAR ALL ============ */

  describe('clearAll', () => {
    test('should clear all cooldowns', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, 'Spam');
      cooldownCache.setCooldown('event1', 'user2', 5000, 'Spam');
      cooldownCache.setCooldown('event2', 'user1', 5000, 'Spam');

      cooldownCache.clearAll();

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
      expect(cooldownCache.isOnCooldown('event1', 'user2')).toBe(false);
      expect(cooldownCache.isOnCooldown('event2', 'user1')).toBe(false);
    });
  });

  /* ============ EXPIRY AND AUTO-CLEANUP ============ */

  describe('Expiry and Auto-Cleanup', () => {
    test('should auto-cleanup expired cooldowns', (done) => {
      cooldownCache.setCooldown('event1', 'user1', 100, 'Short');
      cooldownCache.setCooldown('event1', 'user2', 100, 'Short');
      cooldownCache.setCooldown('event1', 'user3', 10000, 'Long');

      setTimeout(() => {
        // Short cooldowns should be expired
        expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
        expect(cooldownCache.isOnCooldown('event1', 'user2')).toBe(false);

        // Long cooldown should still be active
        expect(cooldownCache.isOnCooldown('event1', 'user3')).toBe(true);

        done();
      }, 200);
    });

    test('should handle rapid expiry checks', (done) => {
      cooldownCache.setCooldown('event1', 'user1', 150, 'Short');

      // Check immediately
      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);

      // Check in middle
      setTimeout(() => {
        expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
      }, 75);

      // Check after expiry
      setTimeout(() => {
        expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(false);
        done();
      }, 200);
    });
  });

  /* ============ EDGE CASES ============ */

  describe('Edge Cases', () => {
    test('should handle very long cooldown duration', () => {
      const longDuration = 365 * 24 * 60 * 60 * 1000; // 1 year
      cooldownCache.setCooldown('event1', 'user1', longDuration, 'Long');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
    });

    test('should handle very short cooldown duration', () => {
      cooldownCache.setCooldown('event1', 'user1', 1, 'Minimal');

      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
    });

    test('should handle special characters in IDs', () => {
      const eventId = 'event-123_abc.def';
      const participantId = 'user@email.com';

      cooldownCache.setCooldown(eventId, participantId, 5000, 'Test');

      expect(cooldownCache.isOnCooldown(eventId, participantId)).toBe(true);
    });

    test('should handle empty reason string', () => {
      cooldownCache.setCooldown('event1', 'user1', 5000, '');

      const cooldown = cooldownCache.getCooldown('event1', 'user1');
      expect(cooldown.reason).toBe('');
    });

    test('should handle null reason gracefully', () => {
      expect(() => {
        cooldownCache.setCooldown('event1', 'user1', 5000, null);
      }).not.toThrow();
    });

    test('should maintain isolation between events', () => {
      // Create same user cooldown in multiple events
      for (let i = 1; i <= 5; i++) {
        cooldownCache.setCooldown(`event${i}`, 'user1', 5000, `Event ${i}`);
      }

      // All should be active
      for (let i = 1; i <= 5; i++) {
        expect(cooldownCache.isOnCooldown(`event${i}`, 'user1')).toBe(true);
      }

      // Clear one event
      cooldownCache.clearEventCooldowns('event3');

      // Check others are unaffected
      expect(cooldownCache.isOnCooldown('event1', 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown('event2', 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown('event3', 'user1')).toBe(false);
      expect(cooldownCache.isOnCooldown('event4', 'user1')).toBe(true);
      expect(cooldownCache.isOnCooldown('event5', 'user1')).toBe(true);
    });
  });
});
