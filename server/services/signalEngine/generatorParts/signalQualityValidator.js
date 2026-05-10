function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validateFinalSignalQuality(context = {}) {
  const {
    trend,
    confidence,
    regimeContext,
    adxContext,
    structureContext,
    srContext,
    cvdContext,
    depthContext,
    liquidationContext
  } = context;

  let penalty = 0;
  let reject = false;
  const reasons = [];

  const confidenceFloor = toNumber(regimeContext?.policy?.confidenceFloor, 58);
  if (confidence < confidenceFloor) {
    reject = true;
    reasons.push(`BELOW_REGIME_CONFIDENCE_FLOOR_${confidenceFloor}`);
  }

  if (adxContext?.flags?.includes('ADX_VERY_WEAK') && regimeContext?.regime !== 'RANGING') {
    penalty -= 8;
    reasons.push('WEAK_TREND_ENVIRONMENT');
  }

  if (structureContext?.flags?.includes('STRUCTURE_MISALIGNED')) {
    penalty -= 10;
    reasons.push('STRUCTURE_CONTRADICTION');
  }

  if (srContext?.flags?.includes('BUY_FAKE_BREAKOUT_RISK') || srContext?.flags?.includes('SELL_FAKE_BREAKOUT_RISK')) {
    reject = true;
    reasons.push('FAKE_BREAKOUT_SIGNATURE');
  }

  if (cvdContext?.flags?.includes('CVD_MISALIGNED') && (cvdContext?.flags?.includes('CVD_BEARISH_DIVERGENCE') || cvdContext?.flags?.includes('CVD_BULLISH_DIVERGENCE'))) {
    penalty -= 8;
    reasons.push('FLOW_DIVERGENCE_CLUSTER');
  }

  if (depthContext?.flags?.includes('DEPTH_SPOOF_RISK') || depthContext?.flags?.includes('DISAPPEARING_LIQUIDITY')) {
    penalty -= 10;
    reasons.push('SPOOF_LIKE_LIQUIDITY');
  }

  if (liquidationContext?.flags?.includes('CASCADE_AGAINST_TREND') || liquidationContext?.flags?.includes('EXHAUSTION_MOVE')) {
    penalty -= 8;
    reasons.push('LIQUIDATION_EXHAUSTION_RISK');
  }

  const contradictoryCluster = reasons.length >= 4;
  if (contradictoryCluster && confidence < 72) {
    reject = true;
    reasons.push('MULTI_FACTOR_CONTRADICTION');
  }

  return {
    reject,
    penalty: clamp(penalty, -22, 0),
    reasons
  };
}

module.exports = {
  validateFinalSignalQuality
};
