function toJoinEventDTO(body) {
  return {
    nickname:
      typeof body.nickname === 'string' ? body.nickname.trim() : body.nickname,
  };
}

function toKickDTO(body) {
  return {
    reason: typeof body.reason === 'string' ? body.reason.trim() : body.reason,
  };
}

function toCooldownDTO(body) {
  return {
    durationMs:
      typeof body.durationMs === 'string'
        ? parseInt(body.durationMs, 10)
        : body.durationMs,
    reason: typeof body.reason === 'string' ? body.reason.trim() : body.reason,
  };
}

function toSetPremiumDTO(body) {
  return {
    isPremium: body.isPremium,
  };
}

module.exports = { toJoinEventDTO, toKickDTO, toCooldownDTO, toSetPremiumDTO };
