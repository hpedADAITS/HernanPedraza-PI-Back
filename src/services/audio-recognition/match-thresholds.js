// Centralised matcher thresholds and confidence-gate evaluation.
//
// The streaming match path used to be entirely threshold-free apart from
// MIN_MATCH_SCORE. That made it noisy: a 700 ms audio chunk produces
// ~50-200 hashes, and random collisions could trip the minimum score on
// noise. This module layers two extra gates on top of MIN_MATCH_SCORE:
//
//   1. Offset concentration  (a.k.a. peak sharpness)
//      For a real match, the aligned hashes cluster at one (source - sample)
//      time delta — the song's true playback offset. For noise, hashes
//      land on many different offsets. We compute
//        concentration = topOffsetCount / totalAligned
//      and require it to be above a threshold. A real match is usually
//      >= 0.6; a noise match is usually <= 0.2.
//
//   2. Margin to runner-up
//      If two tracks tie for the top score, we cannot pick a winner.
//        margin = top.score / max(second.score, 1)
//      and require it to be above a threshold. A clean winner has
//      margin >> 1; a coin-flip is exactly 1.
//
// All three gates are tunable from config.matcher. The defaults are
// conservative; raise them in production to trade recall for precision.

const config = require('../../config');

const DEFAULTS = {
  minScore: 4,
  minOffsetConcentration: 0.5,
  minMarginRatio: 1.5,
};

function resolveThresholds(overrides = {}) {
  const values = overrides || {};
  const base = config?.matcher || {};
  return {
    minScore: Number.isFinite(values.minScore) ? values.minScore : (base.minScore ?? DEFAULTS.minScore),
    minOffsetConcentration: Number.isFinite(values.minOffsetConcentration)
      ? values.minOffsetConcentration
      : (base.minOffsetConcentration ?? DEFAULTS.minOffsetConcentration),
    minMarginRatio: Number.isFinite(values.minMarginRatio)
      ? values.minMarginRatio
      : (base.minMarginRatio ?? DEFAULTS.minMarginRatio),
  };
}

// A single match fails the absolute gate if it does not clear the
// minimum score and either the minimum offset concentration or a strong
// absolute score. The score bypass keeps transformed but real streams
// usable while low-score noise still fails.
function evaluateAbsoluteGates(match, thresholds = {}) {
  const { minScore, minOffsetConcentration } = resolveThresholds(thresholds);
  const failures = {};

  const score = Number(match?.score) || 0;
  if (score < minScore) {
    failures.score = { value: score, threshold: minScore };
  }

  const concentration = computeOffsetConcentration(match);
  if (concentration < minOffsetConcentration && score < minScore * 10) {
    failures.offsetConcentration = { value: concentration, threshold: minOffsetConcentration };
  }

  return { passed: Object.keys(failures).length === 0, failures, concentration };
}

// True if the candidate is a confident winner of the ranking.
// The relative gate is only applied when there is more than one
// candidate; with a single candidate, margin is undefined.
function isConfidentWinner(matches, thresholds = {}) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return { winner: null, reason: 'no_candidates' };
  }

  const sorted = [...matches].sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = sorted[0];
  const second = sorted[1];

  const absolute = evaluateAbsoluteGates(top, thresholds);
  if (!absolute.passed) {
    return { winner: null, reason: 'absolute_failed', failures: absolute.failures, top, second };
  }

  if (second) {
    const { minMarginRatio } = resolveThresholds(thresholds);
    const ratio = (top.score || 0) / Math.max(1, second.score || 0);
    if (ratio < minMarginRatio) {
      return { winner: null, reason: 'margin_too_low', margin: ratio, threshold: minMarginRatio, top, second };
    }
  }

  return { winner: top, top, second, concentration: absolute.concentration };
}

// Concentration is a derived value, not a stored one. We compute it
// defensively so a caller that passes only { score, totalAligned } still
// works.
function computeOffsetConcentration(match) {
  if (!match) return 0;
  if (Number.isFinite(match.offsetConcentration)) {
    return match.offsetConcentration;
  }
  const top = Number(match.score) || 0;
  const total = Number(match.totalAligned) || 0;
  if (total <= 0) return 0;
  return top / total;
}

module.exports = {
  resolveThresholds,
  evaluateAbsoluteGates,
  isConfidentWinner,
  computeOffsetConcentration,
  DEFAULTS,
};
