const { ValidationError } = require("../errors");

function validateJoinEvent(data) {
  const { nickname } = data;
  if (!nickname || typeof nickname !== "string") {
    throw new ValidationError("Nickname is required");
  }
  const trimmed = nickname.trim();
  if (trimmed.length < 2) {
    throw new ValidationError("Nickname must be at least 2 characters");
  }
  if (trimmed.length > 30) {
    throw new ValidationError("Nickname must be less than 30 characters");
  }
}

function validateKickParticipant(data) {
  const { reason } = data;
  if (!reason || typeof reason !== "string") {
    throw new ValidationError("Kick reason is required");
  }
  if (reason.trim().length < 1) {
    throw new ValidationError("Kick reason cannot be empty");
  }
  if (reason.trim().length > 200) {
    throw new ValidationError("Kick reason must be less than 200 characters");
  }
}

function validateCooldown(data) {
  const { durationMs, reason } = data;
  if (!durationMs || typeof durationMs !== "number") {
    throw new ValidationError("Cooldown duration is required");
  }
  if (durationMs < 1000) {
    throw new ValidationError("Cooldown must be at least 1 second");
  }
  if (durationMs > 86400000) {
    throw new ValidationError("Cooldown cannot exceed 24 hours");
  }
  if (!reason || typeof reason !== "string") {
    throw new ValidationError("Cooldown reason is required");
  }
  if (reason.trim().length < 1) {
    throw new ValidationError("Cooldown reason cannot be empty");
  }
}

function validateSetPremium(data) {
  if (typeof data.isPremium !== "boolean") {
    throw new ValidationError("isPremium must be a boolean");
  }
}

module.exports = { validateJoinEvent, validateKickParticipant, validateCooldown, validateSetPremium };
