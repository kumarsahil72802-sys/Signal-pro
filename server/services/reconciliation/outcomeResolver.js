const { settings } = require('../signalEngine/config');

const {
  SIGNAL_VALIDITY_MS,
  SIGNAL_REPLAY_AMBIGUITY_POLICY
} = settings;

function resolveSignalValidUntil(signal) {
  if (!signal) return null;
  if (signal.validUntil) {
    const ts = new Date(signal.validUntil).getTime();
    if (Number.isFinite(ts)) return new Date(ts);
  }
  if (!signal.createdAt) return null;
  const createdTs = new Date(signal.createdAt).getTime();
  if (!Number.isFinite(createdTs)) return null;
  return new Date(createdTs + SIGNAL_VALIDITY_MS);
}

function detectCandleHits(signal, candle) {
  if (!signal || !candle) return { targetHit: false, stopHit: false };

  const high = Number(candle.high);
  const low = Number(candle.low);
  const target = Number(signal.target);
  const stopLoss = Number(signal.stopLoss);

  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return { targetHit: false, stopHit: false };
  }

  if (signal.type === 'BUY') {
    return {
      targetHit: high >= target,
      stopHit: low <= stopLoss
    };
  }

  return {
    targetHit: low <= target,
    stopHit: high >= stopLoss
  };
}

function normalizeAmbiguityPolicy(policy) {
  const candidate = String(policy || SIGNAL_REPLAY_AMBIGUITY_POLICY || 'CONSERVATIVE').toUpperCase();
  return candidate === 'OPTIMISTIC' ? 'OPTIMISTIC' : 'CONSERVATIVE';
}

function resolveReplayOutcome(signal, candles, options = {}) {
  const policy = normalizeAmbiguityPolicy(options.ambiguityPolicy);
  const safeCandles = Array.isArray(candles) ? candles : [];
  let ambiguousCount = 0;

  for (const candle of safeCandles) {
    const { targetHit, stopHit } = detectCandleHits(signal, candle);
    if (!targetHit && !stopHit) continue;

    const closeTimeMs = Number(candle.closeTime) || Number(candle.openTime) || Date.now();
    const hitAt = new Date(closeTimeMs);

    if (targetHit && stopHit) {
      ambiguousCount += 1;
      if (policy === 'OPTIMISTIC') {
        return {
          resolved: true,
          result: 'TARGET_HIT',
          hitAt,
          reason: 'ambiguous_same_candle_target_first',
          ambiguousCount
        };
      }
      return {
        resolved: true,
        result: 'SL_HIT',
        hitAt,
        reason: 'ambiguous_same_candle_sl_first',
        ambiguousCount
      };
    }

    if (targetHit) {
      return {
        resolved: true,
        result: 'TARGET_HIT',
        hitAt,
        reason: 'target_touched',
        ambiguousCount
      };
    }

    return {
      resolved: true,
      result: 'SL_HIT',
      hitAt,
      reason: 'stop_touched',
      ambiguousCount
    };
  }

  return {
    resolved: false,
    result: null,
    hitAt: null,
    reason: 'no_touch_in_window',
    ambiguousCount
  };
}

module.exports = {
  resolveSignalValidUntil,
  resolveReplayOutcome,
  detectCandleHits,
  normalizeAmbiguityPolicy
};
