function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sumWithCap(values = [], minCap = -999, maxCap = 999) {
  const total = values.reduce((sum, item) => sum + toNumber(item), 0);
  return clamp(total, minCap, maxCap);
}

function buildContradictionPenalty(components = {}, trend) {
  let contradictions = 0;
  const reasons = [];

  const sr = components.supportResistance;
  if (sr?.flags?.includes('BUY_NEAR_RESISTANCE') && trend === 'BUY') {
    contradictions += 1;
    reasons.push('near_resistance');
  }
  if (sr?.flags?.includes('SELL_NEAR_SUPPORT') && trend === 'SELL') {
    contradictions += 1;
    reasons.push('near_support');
  }

  const structure = components.structure;
  if (structure?.flags?.includes('STRUCTURE_MISALIGNED')) {
    contradictions += 1;
    reasons.push('structure_misaligned');
  }

  const adx = components.adx;
  if (adx?.flags?.includes('ADX_VERY_WEAK') || adx?.flags?.includes('SIDEWAYS_BREAKOUT_SUPPRESSION')) {
    contradictions += 1;
    reasons.push('weak_adx');
  }

  const cvd = components.cvd;
  if (cvd?.flags?.includes('CVD_MISALIGNED') || cvd?.flags?.includes('CVD_BEARISH_DIVERGENCE') || cvd?.flags?.includes('CVD_BULLISH_DIVERGENCE')) {
    contradictions += 1;
    reasons.push('cvd_conflict');
  }

  const liquidation = components.liquidation;
  if (liquidation?.flags?.includes('EXHAUSTION_MOVE') || liquidation?.flags?.includes('CASCADE_AGAINST_TREND')) {
    contradictions += 1;
    reasons.push('liquidation_stress');
  }

  let penalty = 0;
  if (contradictions >= 4) penalty = -15;
  else if (contradictions === 3) penalty = -10;
  else if (contradictions === 2) penalty = -6;

  return {
    contradictions,
    penalty,
    reasons
  };
}

function calibrateConfidence(baseConfidence, componentMap = {}, trend = 'BUY') {
  const base = clamp(toNumber(baseConfidence), 0, 100);

  const trendContext = sumWithCap([
    componentMap.adx?.adjustment,
    componentMap.structure?.adjustment,
    componentMap.regime?.adjustment
  ], -20, 18);

  const liquidityContext = sumWithCap([
    componentMap.supportResistance?.adjustment,
    componentMap.cvd?.adjustment,
    componentMap.depth?.adjustment,
    componentMap.realtime?.adjustment,
    componentMap.futures?.adjustment
  ], -22, 16);

  const macroContext = sumWithCap([
    componentMap.sentimentAdjustment,
    componentMap.marketGuardrail?.adjustment,
    componentMap.segment?.adjustment
  ], -12, 10);

  const liquidationContext = sumWithCap([
    componentMap.liquidation?.adjustment
  ], -18, 8);

  const contradiction = buildContradictionPenalty(componentMap, trend);

  const boundedPositive = clamp(
    Math.max(0, trendContext) + Math.max(0, liquidityContext) + Math.max(0, macroContext) + Math.max(0, liquidationContext),
    0,
    22
  );

  const boundedNegative = clamp(
    Math.min(0, trendContext) + Math.min(0, liquidityContext) + Math.min(0, macroContext) + Math.min(0, liquidationContext),
    -36,
    0
  );

  let finalConfidence = base + boundedPositive + boundedNegative + contradiction.penalty;

  if (base < 62 && boundedPositive < 8) {
    finalConfidence = Math.min(finalConfidence, 64);
  }

  finalConfidence = clamp(finalConfidence, 0, 100);

  return {
    finalConfidence,
    breakdown: {
      base,
      trendContext,
      liquidityContext,
      macroContext,
      liquidationContext,
      contradictionPenalty: contradiction.penalty
    },
    contradiction
  };
}

module.exports = {
  calibrateConfidence
};
