/**
 * In-memory cooldown cache for participants
 * Cooldowns are ephemeral per event, no DB persistence
 * Format: { eventId: { participantId: { expiresAt, reason } } }
 */
class CooldownCache {
  constructor() {
    this.cache = {};
  }

  /**
   * Set cooldown for participant
   * @param {string} eventId - Event ID
   * @param {string} participantId - Participant ID
   * @param {number} durationMs - Duration in milliseconds
   * @param {string} reason - Reason for cooldown
   */
  setCooldown(eventId, participantId, durationMs, reason = 'Spam prevention') {
    if (!this.cache[eventId]) {
      this.cache[eventId] = {};
    }

    const expiresAt = Date.now() + durationMs;
    this.cache[eventId][participantId] = {
      expiresAt,
      reason,
    };
  }

  /**
   * Check if participant is on cooldown
   * @param {string} eventId - Event ID
   * @param {string} participantId - Participant ID
   * @returns {boolean} true if on cooldown
   */
  isOnCooldown(eventId, participantId) {
    if (!this.cache[eventId] || !this.cache[eventId][participantId]) {
      return false;
    }

    const entry = this.cache[eventId][participantId];
    if (Date.now() > entry.expiresAt) {
      // Cooldown expired, clean up
      delete this.cache[eventId][participantId];
      return false;
    }

    return true;
  }

  /**
   * Get cooldown info
   * @param {string} eventId - Event ID
   * @param {string} participantId - Participant ID
   * @returns {object|null} Cooldown entry or null
   */
  getCooldown(eventId, participantId) {
    if (!this.cache[eventId] || !this.cache[eventId][participantId]) {
      return null;
    }

    const entry = this.cache[eventId][participantId];
    if (Date.now() > entry.expiresAt) {
      delete this.cache[eventId][participantId];
      return null;
    }

    return entry;
  }

  /**
   * Clear cooldown for participant
   * @param {string} eventId - Event ID
   * @param {string} participantId - Participant ID
   */
  clearCooldown(eventId, participantId) {
    if (this.cache[eventId]) {
      delete this.cache[eventId][participantId];
    }
  }

  /**
   * Clear all cooldowns for event (e.g., when event ends)
   * @param {string} eventId - Event ID
   */
  clearEventCooldowns(eventId) {
    delete this.cache[eventId];
  }

  /**
   * Clear all cooldowns from cache
   */
  clearAll() {
    this.cache = {};
  }

  /**
   * Auto-cleanup: Remove expired entries periodically
   */
  cleanup() {
    const now = Date.now();
    for (const eventId in this.cache) {
      for (const participantId in this.cache[eventId]) {
        if (now > this.cache[eventId][participantId].expiresAt) {
          delete this.cache[eventId][participantId];
        }
      }
      // Remove empty event entries
      if (Object.keys(this.cache[eventId]).length === 0) {
        delete this.cache[eventId];
      }
    }
  }
}

module.exports = new CooldownCache();
