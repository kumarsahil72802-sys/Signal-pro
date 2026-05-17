function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function regimeRiskEnvelope(rawRegime = 'RANGING') {
  const regime = String(rawRegime || 'RANGING').toUpperCase();
  switch (regime) {
    case 'TRENDING':
      return { regime, minRR: 1.35, maxTargetPct: 8.5, minStopAtr: 0.8, maxStopAtr: 3.1, structureBufferAtr: 0.9 };
    case 'BREAKOUT':
      return { regime, minRR: 1.4, maxTargetPct: 10.5, minStopAtr: 1.0, maxStopAtr: 3.6, structureBufferAtr: 1.2 };
    case 'HIGH_VOLATILITY':
      return { regime, minRR: 1.3, maxTargetPct: 9.5, minStopAtr: 1.2, maxStopAtr: 4.2, structureBufferAtr: 0.95 };
    case 'LOW_VOLATILITY':
      return { regime, minRR: 1.2, maxTargetPct: 4.2, minStopAtr: 0.65, maxStopAtr: 2.6, structureBufferAtr: 0.45 };
    case 'CHOPPY':
      return { regime, minRR: 1.2, maxTargetPct: 3.8, minStopAtr: 1.05, maxStopAtr: 3.2, structureBufferAtr: 0.4 };
    case 'RANGING':
    default:
      return { regime: 'RANGING', minRR: 1.2, maxTargetPct: 4.8, minStopAtr: 0.8, maxStopAtr: 2.8, structureBufferAtr: 0.6 };
  }
}

function resolveNearestStructurePrice(trend, supportResistance) {
  const sr = supportResistance?.signalImpact || supportResistance || {};
  const nearestSupport = toNumber(sr?.nearestSupport?.price, NaN);
  const nearestResistance = toNumber(sr?.nearestResistance?.price, NaN);
  if (trend === 'BUY' && Number.isFinite(nearestResistance)) return nearestResistance;
  if (trend === 'SELL' && Number.isFinite(nearestSupport)) return nearestSupport;
  return NaN;
}

function evaluateRiskSanity(payload = {}) {
  const trend = String(payload.trend || '').toUpperCase();
  const entryPrice = toNumber(payload.entryPrice, NaN);
  const target = toNumber(payload.target, NaN);
  const stopLoss = toNumber(payload.stopLoss, NaN);
  const profile = regimeRiskEnvelope(payload.regime);
  const issues = [];

  if (!['BUY', 'SELL'].includes(trend)) {
    return { valid: false, issues: ['INVALID_TREND'], profile, metrics: null };
  }
  if (!Number.isFinite(entryPrice) || !Number.isFinite(target) || !Number.isFinite(stopLoss) || entryPrice <= 0 || target <= 0 || stopLoss <= 0) {
    return { valid: false, issues: ['INVALID_PRICE_INPUT'], profile, metrics: null };
  }

  const safeAtr = Math.max(toNumber(payload.atr, 0), entryPrice * 0.0055);
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(target - entryPrice);
  const rr = risk > 0 ? reward / risk : 0;
  const stopAtr = safeAtr > 0 ? risk / safeAtr : 0;
  const targetPct = entryPrice > 0 ? (reward / entryPrice) * 100 : 0;
  const minRequiredRr = Math.max(profile.minRR, toNumber(payload.minRequiredRr, profile.minRR));

  if (trend === 'BUY') {
    if (!(target > entryPrice && stopLoss < entryPrice)) issues.push('DIRECTION_MISMATCH');
  } else if (!(target < entryPrice && stopLoss > entryPrice)) {
    issues.push('DIRECTION_MISMATCH');
  }

  if (stopAtr < profile.minStopAtr) issues.push('STOP_TOO_TIGHT');
  if (stopAtr > profile.maxStopAtr) issues.push('STOP_TOO_WIDE');
  if (targetPct > profile.maxTargetPct) issues.push('UNREALISTIC_TARGET_DISTANCE');
  if (rr < minRequiredRr) issues.push('RR_BELOW_MIN_REQUIRED');

  const structureReference = resolveNearestStructurePrice(trend, payload.supportResistance);
  if (Number.isFinite(structureReference)) {
    const confidence = toNumber(payload.confidence, 0);
    const allowStructureExtension = ['TRENDING', 'BREAKOUT'].includes(profile.regime) && confidence >= 72;
    const structureBufferAtr = allowStructureExtension ? (profile.structureBufferAtr + 0.45) : profile.structureBufferAtr;
    if (trend === 'BUY') {
      const maxReasonableTarget = structureReference + (safeAtr * structureBufferAtr);
      if (target > maxReasonableTarget) issues.push('TARGET_BEYOND_STRUCTURE_CAP');
    } else {
      const minReasonableTarget = structureReference - (safeAtr * structureBufferAtr);
      if (target < minReasonableTarget) issues.push('TARGET_BEYOND_STRUCTURE_CAP');
    }
  }

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    profile,
    metrics: {
      rr,
      risk,
      reward,
      safeAtr,
      stopAtr,
      targetPct,
      minRequiredRr
    }
  };
}

module.exports = {
  evaluateRiskSanity,
  regimeRiskEnvelope
};
