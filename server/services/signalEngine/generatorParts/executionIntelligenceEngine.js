function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(digits));
}

function resolvePriceDecimals(price) {
  if (!Number.isFinite(price) || price <= 0) return 4;
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  if (price >= 1) return 4;
  if (price >= 0.1) return 5;
  if (price >= 0.01) return 6;
  if (price >= 0.001) return 7;
  return 8;
}

function roundPrice(price, decimals) {
  const parsed = toNumber(price, 0);
  if (parsed <= 0) return 0;
  return Number(parsed.toFixed(decimals));
}

function regimeProfile(rawRegime = 'RANGING') {
  const regime = String(rawRegime || 'RANGING').toUpperCase();
  switch (regime) {
    case 'TRENDING':
      return { regime, minRR: 1.35, targetRR: 1.9, maxTargetPct: 8.5, minStopAtr: 0.8, maxStopAtr: 3.1 };
    case 'BREAKOUT':
      return { regime, minRR: 1.4, targetRR: 2.2, maxTargetPct: 10.5, minStopAtr: 1.0, maxStopAtr: 3.6 };
    case 'HIGH_VOLATILITY':
      return { regime, minRR: 1.3, targetRR: 1.8, maxTargetPct: 9.5, minStopAtr: 1.2, maxStopAtr: 4.2 };
    case 'LOW_VOLATILITY':
      return { regime, minRR: 1.2, targetRR: 1.5, maxTargetPct: 4.2, minStopAtr: 0.65, maxStopAtr: 2.6 };
    case 'CHOPPY':
      return { regime, minRR: 1.2, targetRR: 1.35, maxTargetPct: 3.8, minStopAtr: 1.05, maxStopAtr: 3.2 };
    case 'RANGING':
    default:
      return { regime: 'RANGING', minRR: 1.2, targetRR: 1.45, maxTargetPct: 4.8, minStopAtr: 0.8, maxStopAtr: 2.8 };
  }
}

function resolveStructureAnchor({
  trend,
  entryPrice,
  atr,
  supportResistance,
  marketStructure
}) {
  const srImpact = supportResistance?.signalImpact || {};
  const nearestSupport = toNumber(srImpact?.nearestSupport?.price, NaN);
  const nearestResistance = toNumber(srImpact?.nearestResistance?.price, NaN);
  const recentSwingLows = Array.isArray(marketStructure?.swings?.lows) ? marketStructure.swings.lows : [];
  const recentSwingHighs = Array.isArray(marketStructure?.swings?.highs) ? marketStructure.swings.highs : [];

  const lastSwingLow = recentSwingLows.length > 0
    ? toNumber(recentSwingLows[recentSwingLows.length - 1]?.price, NaN)
    : NaN;
  const lastSwingHigh = recentSwingHighs.length > 0
    ? toNumber(recentSwingHighs[recentSwingHighs.length - 1]?.price, NaN)
    : NaN;

  const candidates = [];
  if (trend === 'BUY') {
    if (Number.isFinite(nearestSupport) && nearestSupport < entryPrice) {
      candidates.push({ source: 'nearest_support', value: nearestSupport });
    }
    if (Number.isFinite(lastSwingLow) && lastSwingLow < entryPrice) {
      candidates.push({ source: 'swing_low', value: lastSwingLow });
    }
    candidates.push({ source: 'atr_fallback', value: entryPrice - atr * 1.05 });
    candidates.sort((a, b) => b.value - a.value);
  } else {
    if (Number.isFinite(nearestResistance) && nearestResistance > entryPrice) {
      candidates.push({ source: 'nearest_resistance', value: nearestResistance });
    }
    if (Number.isFinite(lastSwingHigh) && lastSwingHigh > entryPrice) {
      candidates.push({ source: 'swing_high', value: lastSwingHigh });
    }
    candidates.push({ source: 'atr_fallback', value: entryPrice + atr * 1.05 });
    candidates.sort((a, b) => a.value - b.value);
  }

  const anchor = candidates[0] || { source: 'atr_fallback', value: trend === 'BUY' ? entryPrice - atr : entryPrice + atr };
  return {
    source: anchor.source,
    price: anchor.value
  };
}

function buildStructureAwareStop({
  trend,
  entryPrice,
  atr,
  regime,
  supportResistance,
  marketStructure,
  orderBookLiquidity,
  liquidationContext
}) {
  const profile = regimeProfile(regime);
  const anchor = resolveStructureAnchor({
    trend,
    entryPrice,
    atr,
    supportResistance,
    marketStructure
  });

  const baseBuffer = Math.max(atr * 0.18, entryPrice * 0.0011);
  let stopPrice = trend === 'BUY'
    ? (anchor.price - baseBuffer)
    : (anchor.price + baseBuffer);

  const structureGap = Math.abs(entryPrice - stopPrice);
  const minDistance = atr * profile.minStopAtr;
  const maxDistance = atr * profile.maxStopAtr;

  if (structureGap < minDistance) {
    stopPrice = trend === 'BUY'
      ? (entryPrice - minDistance)
      : (entryPrice + minDistance);
  }
  if (structureGap > maxDistance) {
    stopPrice = trend === 'BUY'
      ? (entryPrice - maxDistance)
      : (entryPrice + maxDistance);
  }

  const hasLiquiditySpoofRisk = Boolean(
    orderBookLiquidity?.flags?.includes('DEPTH_SPOOF_RISK')
    || orderBookLiquidity?.flags?.includes('DISAPPEARING_LIQUIDITY')
    || orderBookLiquidity?.depthPersistence?.spoofRiskScore >= 75
  );
  const cascadeRisk = Boolean(liquidationContext?.liquidationCascade);

  if (hasLiquiditySpoofRisk || cascadeRisk) {
    const widenBy = atr * (cascadeRisk ? 0.45 : 0.28);
    stopPrice = trend === 'BUY' ? (stopPrice - widenBy) : (stopPrice + widenBy);
  }

  const finalDistance = Math.abs(entryPrice - stopPrice);
  const atrMultiple = atr > 0 ? finalDistance / atr : 0;

  let quality = 'GOOD';
  if (atrMultiple < profile.minStopAtr * 0.95) quality = 'TOO_TIGHT';
  if (atrMultiple > profile.maxStopAtr * 1.05) quality = 'TOO_WIDE';

  const reasonParts = [
    `anchor:${anchor.source}`,
    `regime:${profile.regime}`,
    `atr_mult:${round(atrMultiple, 2)}`
  ];
  if (hasLiquiditySpoofRisk) reasonParts.push('liquidity_buffer');
  if (cascadeRisk) reasonParts.push('cascade_buffer');

  return {
    price: stopPrice,
    distance: finalDistance,
    distancePct: entryPrice > 0 ? (finalDistance / entryPrice) * 100 : 0,
    atrMultiple,
    quality,
    anchor,
    reason: reasonParts.join(' | ')
  };
}

function buildResistanceAwareTarget({
  trend,
  entryPrice,
  atr,
  regime,
  stopDistance,
  supportResistance,
  adxContext,
  momentum,
  volumeData
}) {
  const profile = regimeProfile(regime);
  const srImpact = supportResistance?.signalImpact || {};
  const nearestResistance = toNumber(srImpact?.nearestResistance?.price, NaN);
  const nearestSupport = toNumber(srImpact?.nearestSupport?.price, NaN);
  const adxStrength = String(adxContext?.strength || '').toUpperCase();

  const momentumStrength = Math.abs(toNumber(momentum));
  const volumeRatio = toNumber(volumeData?.ratio);
  const momentumStrong = momentumStrength >= 1.3;
  const volumeStrong = volumeRatio >= 1.18;
  const trendStrong = adxStrength === 'STRONG' || adxStrength === 'VERY_STRONG';
  const allowExtension = ['TRENDING', 'BREAKOUT'].includes(profile.regime) && trendStrong && momentumStrong && volumeStrong;

  const rrTargetDistance = stopDistance * profile.targetRR;
  let structureTarget = trend === 'BUY'
    ? nearestResistance
    : nearestSupport;

  if (!Number.isFinite(structureTarget)) {
    structureTarget = trend === 'BUY'
      ? (entryPrice + rrTargetDistance)
      : (entryPrice - rrTargetDistance);
  }

  const safetyOffset = atr * 0.12;
  let baseTarget = trend === 'BUY'
    ? Math.max(structureTarget - safetyOffset, entryPrice + atr * 0.75)
    : Math.min(structureTarget + safetyOffset, entryPrice - atr * 0.75);

  if (allowExtension) {
    const extension = atr * clamp(momentumStrength * 0.22, 0.22, 1.35);
    baseTarget = trend === 'BUY' ? (baseTarget + extension) : (baseTarget - extension);
  }

  const maxDistance = entryPrice * (profile.maxTargetPct / 100);
  const rawDistance = Math.abs(baseTarget - entryPrice);
  let targetDistance = Math.min(rawDistance, maxDistance);
  if (targetDistance < atr * 0.9) targetDistance = atr * 0.9;

  const targetPrice = trend === 'BUY'
    ? (entryPrice + targetDistance)
    : (entryPrice - targetDistance);

  const quality = rawDistance > maxDistance * 1.04
    ? 'UNREALISTIC'
    : allowExtension ? 'MOMENTUM_EXTENDED' : 'STRUCTURE_CAPPED';

  const reason = [
    `regime:${profile.regime}`,
    `structure_ref:${Number.isFinite(structureTarget) ? round(structureTarget, 6) : 'fallback'}`,
    allowExtension ? 'breakout_extension' : 'conservative_target'
  ].join(' | ');

  return {
    price: targetPrice,
    distance: targetDistance,
    distancePct: entryPrice > 0 ? (targetDistance / entryPrice) * 100 : 0,
    quality,
    reason
  };
}

function scoreRR(rr, regime) {
  const profile = regimeProfile(regime);
  if (!Number.isFinite(rr) || rr <= 0) return 0;
  if (rr < 1) return 20;
  if (rr < profile.minRR) return 42;
  if (rr >= profile.targetRR * 1.15) return 96;
  const normalized = ((rr - profile.minRR) / Math.max(0.01, profile.targetRR - profile.minRR));
  return clamp(Math.round(55 + normalized * 35), 0, 100);
}

function mapRiskGrade(score) {
  if (score >= 78) return 'LOW';
  if (score >= 62) return 'MEDIUM';
  if (score >= 46) return 'HIGH';
  return 'EXTREME';
}

function gradeFromScore(score) {
  if (score >= 90) return 'A+';
  if (score >= 82) return 'A';
  if (score >= 72) return 'B';
  if (score >= 62) return 'C';
  if (score >= 50) return 'D';
  return 'REJECTED';
}

function resolveAgreementStrength(agreementScore) {
  if (!Number.isFinite(agreementScore)) return 'UNKNOWN';
  if (agreementScore >= 75) return 'STRONG';
  if (agreementScore >= 58) return 'ACCEPTABLE';
  if (agreementScore >= 45) return 'FRAGILE';
  return 'CONFLICT';
}

function evaluateExecutionIntelligence(context = {}) {
  const {
    signalData = {},
    trend,
    currentPrice,
    atr,
    regimeContext,
    supportResistance,
    marketStructure,
    structureContext,
    orderBookLiquidity,
    liquidationContext,
    depthContext,
    volumeData,
    momentum,
    adxContext,
    executionQualityData
  } = context;

  const safeEntry = toNumber(signalData.entryPrice, toNumber(currentPrice));
  const safeAtr = Math.max(toNumber(atr), safeEntry * 0.0055);
  const regime = String(regimeContext?.regime || 'RANGING').toUpperCase();
  const profile = regimeProfile(regime);
  const decimals = resolvePriceDecimals(safeEntry);

  const stop = buildStructureAwareStop({
    trend,
    entryPrice: safeEntry,
    atr: safeAtr,
    regime,
    supportResistance,
    marketStructure,
    orderBookLiquidity,
    liquidationContext
  });

  const target = buildResistanceAwareTarget({
    trend,
    entryPrice: safeEntry,
    atr: safeAtr,
    regime,
    stopDistance: stop.distance,
    supportResistance,
    adxContext,
    momentum,
    volumeData
  });

  const roundedEntry = roundPrice(safeEntry, decimals);
  let roundedStop = roundPrice(stop.price, decimals);
  let roundedTarget = roundPrice(target.price, decimals);
  const minTick = Math.pow(10, -decimals);

  if (trend === 'BUY') {
    if (roundedStop >= roundedEntry) roundedStop = roundPrice(Math.max(minTick, roundedEntry - minTick), decimals);
    if (roundedTarget <= roundedEntry) roundedTarget = roundPrice(roundedEntry + minTick, decimals);
  } else {
    if (roundedStop <= roundedEntry) roundedStop = roundPrice(roundedEntry + minTick, decimals);
    if (roundedTarget >= roundedEntry) roundedTarget = roundPrice(Math.max(minTick, roundedEntry - minTick), decimals);
  }

  const risk = Math.abs(roundedEntry - roundedStop);
  const reward = Math.abs(roundedTarget - roundedEntry);
  const rr = risk > 0 ? reward / risk : 0;
  const rrScore = scoreRR(rr, regime);

  const structureAligned = Boolean(structureContext?.aligned);
  const liquidityPenalty = (
    orderBookLiquidity?.blockedByLiquidity
      ? 22
      : depthContext?.flags?.includes('DEPTH_SPOOF_RISK')
        ? 14
        : 0
  );
  const executionRiskPenalty = String(executionQualityData?.executionQuality || '').toUpperCase() === 'RISKY' ? 18 : 0;
  const slippagePenalty = String(executionQualityData?.slippageRisk || '').toUpperCase() === 'HIGH' ? 14 : 0;

  const stopQualityScore = stop.quality === 'GOOD' ? 82 : stop.quality === 'TOO_TIGHT' ? 35 : 42;
  const targetRealismScore = target.quality === 'UNREALISTIC' ? 30 : target.quality === 'MOMENTUM_EXTENDED' ? 80 : 74;
  const structureScore = structureAligned ? 82 : 42;
  const volatilityScore = clamp(88 - Math.abs(stop.atrMultiple - 1.4) * 22, 25, 92);

  const contradictionFlags = [];
  let hardReject = false;

  if (rr < 1.2) {
    hardReject = true;
    contradictionFlags.push('RR_BELOW_MIN_1_2');
  }
  if (reward <= risk) {
    hardReject = true;
    contradictionFlags.push('RISK_EXCEEDS_REWARD');
  }
  if (target.quality === 'UNREALISTIC') {
    hardReject = true;
    contradictionFlags.push('UNREALISTIC_TARGET_DISTANCE');
  }
  if (stop.quality === 'TOO_TIGHT') {
    hardReject = true;
    contradictionFlags.push('STOP_TOO_TIGHT');
  }
  if (stop.quality === 'TOO_WIDE') {
    contradictionFlags.push('STOP_TOO_WIDE');
  }
  if (!structureAligned) contradictionFlags.push('STRUCTURE_MISALIGNED');
  if (orderBookLiquidity?.blockedByLiquidity) contradictionFlags.push('LIQUIDITY_BLOCKED');
  if (depthContext?.flags?.includes('DEPTH_SPOOF_RISK')) contradictionFlags.push('SPOOF_RISK');
  if (liquidationContext?.flags?.includes('CASCADE_AGAINST_TREND')) contradictionFlags.push('CASCADE_AGAINST_TREND');

  const executionRealismScore = clamp(Math.round(
    (rrScore * 0.28)
    + (stopQualityScore * 0.2)
    + (targetRealismScore * 0.2)
    + (structureScore * 0.16)
    + (volatilityScore * 0.16)
    - liquidityPenalty
    - executionRiskPenalty
    - slippagePenalty
  ), 0, 100);

  const survivabilityScore = clamp(Math.round(
    (stopQualityScore * 0.3)
    + (structureScore * 0.24)
    + (volatilityScore * 0.22)
    + (Math.max(0, 90 - contradictionFlags.length * 8) * 0.24)
    - liquidityPenalty * 0.5
  ), 0, 100);

  const combinedBaseScore = clamp(Math.round(
    executionRealismScore * 0.63
    + survivabilityScore * 0.24
    + rrScore * 0.13
  ), 0, 100);

  const riskGrade = mapRiskGrade(Math.round((executionRealismScore * 0.55) + (survivabilityScore * 0.45)));
  const baseTradeQualityGrade = hardReject ? 'REJECTED' : gradeFromScore(combinedBaseScore);

  const decisionHint = hardReject
    ? 'SKIP'
    : combinedBaseScore >= 78 && rr >= profile.minRR ? 'TAKE'
      : combinedBaseScore >= 58 ? 'WAIT'
        : 'SKIP';

  return {
    entryPrice: roundedEntry,
    stopLoss: roundedStop,
    target: roundedTarget,
    rrAnalysis: {
      ratio: round(rr, 3),
      risk: round(risk, decimals),
      reward: round(reward, decimals),
      minRequiredByRegime: profile.minRR,
      targetByRegime: profile.targetRR,
      status: rr >= profile.minRR ? 'HEALTHY' : 'WEAK',
      reason: rr < 1.2 ? 'rr_below_minimum' : rr >= profile.targetRR ? 'regime_target_met' : 'acceptable_rr'
    },
    stop: {
      distancePct: round(stop.distancePct, 4),
      atrMultiple: round(stop.atrMultiple, 3),
      quality: stop.quality,
      reason: stop.reason
    },
    targetModel: {
      distancePct: round(target.distancePct, 4),
      quality: target.quality,
      reason: target.reason
    },
    scores: {
      rrQuality: rrScore,
      stopQuality: stopQualityScore,
      targetRealism: targetRealismScore,
      structureAlignment: structureScore,
      volatilityFit: round(volatilityScore, 2),
      survivability: survivabilityScore,
      executionRealism: executionRealismScore
    },
    riskGrade,
    contradictions: contradictionFlags,
    contradictionCount: contradictionFlags.length,
    hardReject,
    baseTradeQualityGrade,
    decisionHint
  };
}

function finalizeExecutionDecision(payload = {}) {
  const {
    executionIntelligence,
    triCore,
    finalConfidence
  } = payload;

  const execution = executionIntelligence || {};
  const triCoreConfidence = toNumber(finalConfidence, toNumber(triCore?.finalConfidence, 0));
  const triCoreDecision = String(triCore?.finalTradeDecision || 'WAIT').toUpperCase();
  const agreementScore = clamp(toNumber(triCore?.agreementScore, 50), 0, 100);
  const agreementStrength = resolveAgreementStrength(agreementScore);
  const contradictionCount = (
    toNumber(execution.contradictionCount, 0)
    + toNumber(triCore?.majorContradictions?.length, 0)
    + Math.floor(toNumber(triCore?.minorRisks?.length, 0) * 0.5)
  );
  const contradictionSeverity = contradictionCount >= 5 ? 'SEVERE' : contradictionCount >= 3 ? 'ELEVATED' : contradictionCount >= 1 ? 'LOW' : 'NONE';

  const executionRealism = toNumber(execution?.scores?.executionRealism, 0);
  const survivability = toNumber(execution?.scores?.survivability, 0);
  const rr = toNumber(execution?.rrAnalysis?.ratio, 0);
  const hardReject = Boolean(execution?.hardReject);

  const gradeScore = clamp(Math.round(
    executionRealism * 0.52
    + survivability * 0.2
    + toNumber(execution?.scores?.rrQuality, 0) * 0.16
    + triCoreConfidence * 0.08
    + agreementScore * 0.04
    - contradictionCount * 3
  ), 0, 100);
  const tradeQualityGrade = hardReject ? 'REJECTED' : gradeFromScore(gradeScore);

  let finalDecision = 'WAIT';
  const reasons = [];

  if (hardReject || rr < 1.2 || tradeQualityGrade === 'REJECTED') {
    finalDecision = 'SKIP';
    reasons.push('Execution rules rejected this setup');
  } else if (
    triCoreConfidence >= 74
    && executionRealism >= 70
    && survivability >= 68
    && rr >= 1.45
    && agreementScore >= 58
    && contradictionSeverity !== 'SEVERE'
    && ['A+', 'A', 'B'].includes(tradeQualityGrade)
  ) {
    finalDecision = 'TAKE';
    reasons.push('TriCore confidence and execution realism are aligned');
  } else if (
    triCoreConfidence >= 60
    && executionRealism >= 56
    && rr >= 1.2
    && contradictionSeverity !== 'SEVERE'
  ) {
    finalDecision = 'WAIT';
    reasons.push('Setup has potential but still carries risk');
  } else {
    finalDecision = 'SKIP';
    reasons.push('Low decision quality after execution validation');
  }

  if (triCoreDecision === 'SKIP' && agreementScore < 50 && finalDecision !== 'SKIP') {
    finalDecision = 'WAIT';
    reasons.push('Validator conflict prevents immediate TAKE');
  }

  if (agreementStrength === 'CONFLICT' && finalDecision === 'TAKE') {
    finalDecision = 'WAIT';
    reasons.push('AI conflict downgraded action to WAIT');
  }

  if (tradeQualityGrade === 'D' && finalDecision === 'TAKE') {
    finalDecision = 'WAIT';
    reasons.push('Trade grade too weak for TAKE');
  }

  return {
    finalDecision,
    tradeQualityGrade,
    agreementStrength,
    contradictionSeverity,
    tradeDecisionReason: reasons.join(' | '),
    executionRealismScore: executionRealism,
    survivabilityScore: survivability
  };
}

module.exports = {
  evaluateExecutionIntelligence,
  finalizeExecutionDecision,
  resolveAgreementStrength
};
