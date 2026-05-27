const { getKlines } = require('../../binanceService');
const { getFuturesContext } = require('../../futuresService');
const { getRealtimeSignalContext } = require('../../binanceRealtimeService');
const { getExecutionQualityForSymbols } = require('../../executionQualityService');
const { saveTradeSnapshot } = require('../../tradeService');
const Signal = require('../../../models/Signal');
const { enhancedAnalyze } = require('../../aiAnalyst');
const { getMacroTrendSnapshot } = require('../../macroService');
const {
  analyzePerformance,
  buildSegmentKey,
  getSegmentAdaptiveAdjustment
} = require('../../aiLearning');
const {
  settings,
  lastSignalTimes
} = require('../config');
const {
  calculateEMA,
  calculateEMASlope,
  checkVolume,
  calculateVolumeDelta,
  detectVolatilityBreakout,
  detectMarketRegime,
  detectAdvancedSignal,
  detectEMAProximity,
  detectEMAZone,
  calculateMomentum,
  calculateShortTermMomentum,
  calculateMidTermMomentum,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  detect4HTrend,
  calculateADX,
  analyzeSupportResistance,
  analyzeMarketStructure,
  evaluateStructureForSignal,
  evaluateAdxForSignal,
  detectMarketRegimeAdvanced,
  evaluateCvdForSignal,
  detectLiquidationPressure,
  calibrateConfidence,
  calcTechnicalScore,
  calcMarketScore,
  calcConfidenceBoost,
  calcConfidencePenalty,
  hasStrongIndicatorConflict,
  getRSIStrengthLevel,
  getMACDStrengthLevel,
  getMomentumStrengthLevel,
  getVolumeStrengthLevel,
  getTrendStrengthLevel,
  calcWeakIndicatorPenalty,
  calcNewsSentiment,
  calculateSentimentAdjustment,
  calculateATR,
  applyFuturesAdjustment,
  applyRealtimeAdjustment
} = require('../analysis');
const {
  getReasonLabels,
  getSignalQuality,
  runQualityFilters,
  applyExecutionQualityAdjustment
} = require('./core');
const { getOrderBookLiquidityForSignal } = require('./orderBook');
const { applyGuardrailPenalties } = require('./guardrails');
const { buildRiskManagedSignalData } = require('./riskEngine');
const { validateFinalSignalQuality } = require('./signalQualityValidator');
const {
  evaluateExecutionIntelligence,
  finalizeExecutionDecision
} = require('./executionIntelligenceEngine');

const {
  COOLDOWN_MS,
  INTERVAL,
  CANDLE_COUNT,
  TREND_CANDLES,
  SIGNAL_ALLOW_RANGING_BREAKOUTS,
  SIGNAL_TRIGGER_SLOPE_MIN_ABS,
  SIGNAL_USE_BTC_HARD_BLOCK,
  SIGNAL_USE_4H_HARD_FILTER,
  SIGNAL_USE_EXECUTION_QUALITY,
  SIGNAL_USE_FUTURES_CONTEXT,
  SIGNAL_USE_REALTIME_CONTEXT,
  SIGNAL_LIQUIDITY_REJECT_MODE,
  SIGNAL_AI_REJECT_MODE,
  SIGNAL_VALIDITY_MS,
  SIGNAL_MACHINE_VERSION,
  SIGNAL_BLOCK_UNFAVORABLE_REGIMES,
  SIGNAL_BLOCKED_REGIMES,
  SIGNAL_REQUIRE_TRADE_DECISION_TAKE,
  SIGNAL_MIN_TRADE_GRADE,
  SIGNAL_MAX_CONTRADICTION_SEVERITY,
  SIGNAL_MIN_AGREEMENT_STRENGTH,
  SIGNAL_MIN_FINAL_AI_CONFIDENCE
} = settings;

const TRADE_GRADE_RANK = {
  REJECTED: 0,
  D: 1,
  C: 2,
  B: 3,
  A: 4,
  'A+': 5
};

const CONTRADICTION_SEVERITY_RANK = {
  NONE: 0,
  LOW: 1,
  ELEVATED: 2,
  SEVERE: 3
};

const AGREEMENT_STRENGTH_RANK = {
  UNKNOWN: 0,
  CONFLICT: 1,
  FRAGILE: 2,
  ACCEPTABLE: 3,
  STRONG: 4
};
const BLOCKED_SIGNAL_CLEANUP_TTL_MS = 8 * 60 * 60 * 1000;

function clampConfidence(value) {
  return Math.max(0, Math.min(100, value));
}

function toNullableNumber(value, decimals = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (Number.isFinite(decimals)) {
    return Number(parsed.toFixed(decimals));
  }
  return parsed;
}

function computeRrFromPrices(entryPrice, target, stopLoss) {
  const entry = Number(entryPrice);
  const targetPrice = Number(target);
  const stop = Number(stopLoss);
  if (!Number.isFinite(entry) || !Number.isFinite(targetPrice) || !Number.isFinite(stop)) return null;

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(targetPrice - entry);
  if (!(risk > 0) || !(reward > 0)) return null;

  return {
    risk,
    reward,
    ratio: reward / risk
  };
}

function isDirectionalRrValid(trend, entryPrice, target, stopLoss) {
  const entry = Number(entryPrice);
  const targetPrice = Number(target);
  const stop = Number(stopLoss);
  if (!Number.isFinite(entry) || !Number.isFinite(targetPrice) || !Number.isFinite(stop)) return false;
  if (trend === 'BUY') return targetPrice > entry && stop < entry;
  if (trend === 'SELL') return targetPrice < entry && stop > entry;
  return false;
}

function applyAiRiskPlanToSignalData(signalData, trend, aiRiskPlan) {
  if (!signalData || !aiRiskPlan || aiRiskPlan.applied !== true) return false;

  const entryPrice = Number(signalData.entryPrice);
  const aiTarget = Number(aiRiskPlan.targetPrice);
  const aiStop = Number(aiRiskPlan.stopLossPrice);
  if (!isDirectionalRrValid(trend, entryPrice, aiTarget, aiStop)) return false;

  const rrMetrics = computeRrFromPrices(entryPrice, aiTarget, aiStop);
  if (!rrMetrics) return false;

  const existingRr = signalData.executionIntelligence?.rrAnalysis || signalData.rrAnalysis || {};
  const minRequiredByRegime = Number.isFinite(Number(existingRr.minRequiredByRegime))
    ? Number(existingRr.minRequiredByRegime)
    : Number.isFinite(Number(aiRiskPlan.minRequiredRr))
      ? Number(aiRiskPlan.minRequiredRr)
      : 1.2;

  if (rrMetrics.ratio < minRequiredByRegime) return false;

  signalData.target = aiTarget;
  signalData.stopLoss = aiStop;
  signalData.rrAnalysis = {
    ...existingRr,
    ratio: Number(rrMetrics.ratio.toFixed(3)),
    risk: Number(rrMetrics.risk.toFixed(8)),
    reward: Number(rrMetrics.reward.toFixed(8)),
    minRequiredByRegime,
    status: rrMetrics.ratio >= minRequiredByRegime ? 'HEALTHY' : 'WEAK',
    reason: `ai_${aiRiskPlan.source || 'consensus'}_optimized`
  };
  signalData.riskModel = {
    ...(signalData.riskModel || {}),
    realizedRR: signalData.rrAnalysis.ratio
  };
  signalData.targetLogicReason = [
    signalData.targetLogicReason,
    `ai_${aiRiskPlan.source || 'consensus'}_optimized`
  ].filter(Boolean).join(' | ');
  signalData.aiRiskPlan = {
    applied: true,
    source: aiRiskPlan.source || 'consensus',
    rr: signalData.rrAnalysis.ratio,
    minRequiredRr: minRequiredByRegime
  };

  const rrQualityScore = (() => {
    const rr = rrMetrics.ratio;
    if (!Number.isFinite(rr) || rr <= 0) return 0;
    if (rr < 1) return 20;
    if (rr < minRequiredByRegime) return 42;
    const targetRr = Number.isFinite(Number(existingRr.targetByRegime))
      ? Number(existingRr.targetByRegime)
      : Math.max(minRequiredByRegime, 1.45);
    if (rr >= targetRr * 1.15) return 96;
    const denominator = Math.max(0.01, targetRr - minRequiredByRegime);
    const normalized = (rr - minRequiredByRegime) / denominator;
    return Math.max(0, Math.min(100, Math.round(55 + normalized * 35)));
  })();

  const existingExecution = signalData.executionIntelligence || {};
  const previousContradictions = Array.isArray(existingExecution.contradictions)
    ? existingExecution.contradictions
    : [];
  const nextContradictions = previousContradictions.filter((flag) => (
    flag !== 'RR_BELOW_MIN_1_2' && flag !== 'RISK_EXCEEDS_REWARD'
  ));
  if (rrMetrics.ratio < 1.2) nextContradictions.push('RR_BELOW_MIN_1_2');
  if (rrMetrics.reward <= rrMetrics.risk) nextContradictions.push('RISK_EXCEEDS_REWARD');

  const contradictionSet = [...new Set(nextContradictions)];
  const hardRejectFlags = new Set([
    'RR_BELOW_MIN_1_2',
    'RISK_EXCEEDS_REWARD',
    'UNREALISTIC_TARGET_DISTANCE',
    'STOP_TOO_TIGHT'
  ]);
  const hardReject = contradictionSet.some((flag) => hardRejectFlags.has(flag));

  signalData.executionIntelligence = {
    ...existingExecution,
    target: aiTarget,
    stopLoss: aiStop,
    rrAnalysis: {
      ...(existingExecution.rrAnalysis || {}),
      ...signalData.rrAnalysis
    },
    scores: {
      ...(existingExecution.scores || {}),
      rrQuality: rrQualityScore
    },
    contradictions: contradictionSet,
    contradictionCount: contradictionSet.length,
    hardReject,
    aiRiskPlan: signalData.aiRiskPlan
  };

  return true;
}

function incrementGateCounter(gateCounters, gate) {
  if (!gateCounters || !gate) return;
  if (!Number.isFinite(gateCounters[gate])) {
    gateCounters[gate] = 0;
  }
  gateCounters[gate] += 1;
}

function warnInvalidSymbolOnce(runtimeContext, message) {
  const invalidState = runtimeContext?.invalidSymbolState;
  if (!invalidState || invalidState.warnIssued) return;
  invalidState.warnIssued = true;

  if (typeof runtimeContext?.onInvalidSymbolWarning === 'function') {
    runtimeContext.onInvalidSymbolWarning(message);
    return;
  }

  console.warn(`[ENGINE] ${message}`);
}

function markSymbolQuarantined(runtimeContext, symbol) {
  const invalidState = runtimeContext?.invalidSymbolState;
  if (!invalidState || !symbol) return;
  if (!(invalidState.quarantinedSymbols instanceof Set)) {
    invalidState.quarantinedSymbols = new Set();
  }
  invalidState.quarantinedSymbols.add(symbol);
  invalidState.runtimeInvalidCount = Number(invalidState.runtimeInvalidCount || 0) + 1;
}

function resolvePendingSignalValidUntil(signal) {
  if (!signal) return null;
  if (signal.validUntil) {
    const validTs = new Date(signal.validUntil).getTime();
    if (Number.isFinite(validTs)) return new Date(validTs);
  }
  if (!signal.createdAt) return null;
  const createdTs = new Date(signal.createdAt).getTime();
  if (!Number.isFinite(createdTs)) return null;
  return new Date(createdTs + SIGNAL_VALIDITY_MS);
}

async function closeExpiredPendingSignals(coin) {
  const unresolvedSignals = await Signal.find({
    coin,
    status: { $in: ['ACTIVE', 'TAKEN'] },
    result: 'PENDING'
  });

  if (!Array.isArray(unresolvedSignals) || unresolvedSignals.length === 0) {
    return { hasUnresolved: false };
  }

  const nowMs = Date.now();
  for (const unresolvedSignal of unresolvedSignals) {
    const validUntil = resolvePendingSignalValidUntil(unresolvedSignal);
    const validUntilMs = validUntil ? validUntil.getTime() : NaN;
    if (!Number.isFinite(validUntilMs) || validUntilMs > nowMs) continue;

    await Signal.findByIdAndUpdate(unresolvedSignal._id, {
      status: 'CLOSED',
      result: 'EXPIRED',
      wasTaken: unresolvedSignal.status === 'TAKEN',
      closedAt: new Date()
    });
    console.log(`[ENGINE] ${coin} stale unresolved signal auto-closed -> EXPIRED`);
  }

  const stillUnresolved = await Signal.findOne({
    coin,
    status: { $in: ['ACTIVE', 'TAKEN'] },
    result: 'PENDING'
  });

  return { hasUnresolved: Boolean(stillUnresolved) };
}

async function canRunForCoin(coin) {
  const pendingLifecycle = await closeExpiredPendingSignals(coin);
  if (pendingLifecycle.hasUnresolved) {
    console.log(`[ENGINE] Duplicate signal blocked: active unresolved signal exists for ${coin}`);
    return { allowed: false, gate: 'cooldown' };
  }

  if (COOLDOWN_MS <= 0) {
    return { allowed: true };
  }

  const recentSignal = await Signal.findOne({
    coin,
    createdAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
  }).sort({ createdAt: -1 });

  if (recentSignal) {
    const elapsed = Date.now() - recentSignal.createdAt.getTime();
    const mins = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
    console.log(`[ENGINE] ${coin} skipped -> Recent signal exists (${mins}m ago)`);
    return { allowed: false, gate: 'cooldown' };
  }

  const lastTime = lastSignalTimes.get(coin);
  if (lastTime) {
    const elapsed = Date.now() - lastTime;
    const remaining = COOLDOWN_MS - elapsed;
    if (remaining > 0) {
      console.log(`[ENGINE] ${coin} skipped -> Cooldown (${Math.ceil(remaining / 60000)}m remaining)`);
      return { allowed: false, gate: 'cooldown' };
    }
  }

  return { allowed: true };
}

function resolveSetup(coin, klines, allCloses, trendCloses, currentPrice, gateCounters = null) {
  const breakoutSignal = detectVolatilityBreakout(klines);

  const regEma9 = calculateEMA(trendCloses, 9);
  const regEma21 = calculateEMA(trendCloses, 21);
  const regSlope = calculateEMASlope(trendCloses);
  const regime = detectMarketRegime(allCloses, regEma9, regEma21, regSlope);
  const slopeAligned = Math.abs(regSlope) >= SIGNAL_TRIGGER_SLOPE_MIN_ABS
    && ((regEma9 > regEma21 && regSlope > 0) || (regEma9 < regEma21 && regSlope < 0));
  const allowRangingSetup = SIGNAL_ALLOW_RANGING_BREAKOUTS && (Boolean(breakoutSignal) || slopeAligned);

  if (regime === 'RANGING' && !allowRangingSetup) {
    console.log(`[ENGINE] ${coin} skipped -> Market Regime is RANGING (M2C2 Phase 1 Filter)`);
    incrementGateCounter(gateCounters, 'ranging');
    return null;
  }

  let advancedSignal = breakoutSignal || detectAdvancedSignal(trendCloses, klines);
  if (!advancedSignal && regime !== 'RANGING') {
    const fallbackSlope = calculateEMASlope(trendCloses);
    const fallbackEma9 = calculateEMA(trendCloses, 9);
    const fallbackEma21 = calculateEMA(trendCloses, 21);
    const fallbackGapPct = Math.abs(fallbackEma9 - fallbackEma21) / currentPrice * 100;
    const fallbackSlopeGate = SIGNAL_TRIGGER_SLOPE_MIN_ABS * 0.5;

    if (fallbackEma9 > fallbackEma21 && (fallbackSlope >= fallbackSlopeGate || fallbackGapPct >= 0.25)) {
      advancedSignal = {
        trigger: 'EMA_ZONE',
        trend: 'BUY',
        ema9: fallbackEma9,
        ema21: fallbackEma21,
        slope: fallbackSlope,
        proximity: detectEMAProximity(currentPrice, fallbackEma9, fallbackEma21),
        zone: detectEMAZone(currentPrice, fallbackEma9, fallbackEma21),
        crossover: false,
        reason: 'Fallback EMA alignment trigger'
      };
    } else if (fallbackEma9 < fallbackEma21 && (fallbackSlope <= -fallbackSlopeGate || fallbackGapPct >= 0.25)) {
      advancedSignal = {
        trigger: 'EMA_ZONE',
        trend: 'SELL',
        ema9: fallbackEma9,
        ema21: fallbackEma21,
        slope: fallbackSlope,
        proximity: detectEMAProximity(currentPrice, fallbackEma9, fallbackEma21),
        zone: detectEMAZone(currentPrice, fallbackEma9, fallbackEma21),
        crossover: false,
        reason: 'Fallback EMA alignment trigger'
      };
    }
  }

  if (!advancedSignal) {
    console.log(`[Engine] ${coin} skipped -> No valid trigger (Flat market)`);
    incrementGateCounter(gateCounters, 'no_trigger');
    return null;
  }

  console.log(`[Engine] ${coin} Trigger: ${advancedSignal.trigger} | Slope: ${advancedSignal.slope.toFixed(2)}% | ${advancedSignal.reason}`);
  return { advancedSignal, regime };
}

function resolveBtcPenalty(coin, btcTrend, trend) {
  if (btcTrend === 'STRONG_BEARISH' && trend === 'BUY') {
    if (SIGNAL_USE_BTC_HARD_BLOCK) {
      console.log(`[Engine] ${coin} BUY signal BLOCKED by BTC Strong Bearish trend`);
      return { blocked: true, penalty: 0 };
    }
    console.log(`[Engine] ${coin} BUY signal penalized (-8) by BTC Strong Bearish trend`);
    return { blocked: false, penalty: -8 };
  }

  if (btcTrend.includes('BULLISH') && trend === 'SELL') {
    console.log(`[Engine] ${coin} SELL signal penalized (-12) by BTC Bullish trend`);
    return { blocked: false, penalty: -12 };
  }

  if (btcTrend === 'BEARISH' && trend === 'BUY') {
    console.log(`[Engine] ${coin} BUY signal penalized (-10) by BTC Bearish trend`);
    return { blocked: false, penalty: -10 };
  }

  return { blocked: false, penalty: 0 };
}

function buildRsiHistory(allCloses) {
  const rsiHistory = [];
  for (let i = 3; i <= 10; i += 3) {
    const histCloses = allCloses.slice(-15 - i, -i);
    if (histCloses.length >= 14) {
      rsiHistory.push(calculateRSI(histCloses));
    }
  }
  return rsiHistory;
}

function apply4HGate(coin, trend, confidence, higherTimeframeTrend) {
  let nextConfidence = confidence;
  let fourHPenalty = 0;

  if (higherTimeframeTrend && SIGNAL_USE_4H_HARD_FILTER) {
    const fourHTrend = higherTimeframeTrend.trend;
    const fourHStrength = higherTimeframeTrend.strength;
    const fourHSlope = higherTimeframeTrend.ema21Slope;

    const opposingBuy = trend === 'BUY' && fourHTrend === 'bearish' && (fourHStrength === 'strong' || fourHStrength === 'moderate');
    const opposingSell = trend === 'SELL' && fourHTrend === 'bullish' && (fourHStrength === 'strong' || fourHStrength === 'moderate');
    if (opposingBuy || opposingSell) {
      console.log(`[ENGINE] ${coin} BLOCKED -> 4H ${fourHStrength} ${fourHTrend} trend opposes 1H ${trend} | slope:${fourHSlope.toFixed(3)}%`);
      return { blocked: true, confidence: nextConfidence, fourHPenalty };
    }

    if (trend === 'BUY' && fourHTrend === 'bearish' && fourHStrength === 'weak') {
      fourHPenalty = -15;
      nextConfidence = Math.max(0, nextConfidence + fourHPenalty);
    }
    if (trend === 'SELL' && fourHTrend === 'bullish' && fourHStrength === 'weak') {
      fourHPenalty = -15;
      nextConfidence = Math.max(0, nextConfidence + fourHPenalty);
    }
  } else if (higherTimeframeTrend) {
    const fourHTrend = higherTimeframeTrend.trend;
    const fourHStrength = higherTimeframeTrend.strength;
    let softPenalty = 0;
    if (trend === 'BUY' && fourHTrend === 'bearish') {
      softPenalty = fourHStrength === 'strong' ? -20 : fourHStrength === 'moderate' ? -12 : -6;
    }
    if (trend === 'SELL' && fourHTrend === 'bullish') {
      softPenalty = fourHStrength === 'strong' ? -20 : fourHStrength === 'moderate' ? -12 : -6;
    }
    if (softPenalty !== 0) {
      fourHPenalty = softPenalty;
      nextConfidence = Math.max(0, nextConfidence + fourHPenalty);
      console.log(`[ENGINE] ${coin} 4H SOFT FILTER -> applied ${softPenalty} penalty (${fourHTrend}/${fourHStrength})`);
    }
  } else {
    console.log(`[Engine] 4H data unavailable for ${coin}, skipping hard filter`);
  }

  return { blocked: false, confidence: nextConfidence, fourHPenalty };
}

async function applyExecutionGate(coin, confidence) {
  let nextConfidence = confidence;
  let executionAdjustment = 0;
  let executionQualityData = null;

  if (SIGNAL_USE_EXECUTION_QUALITY) {
    try {
      const qualityMap = await getExecutionQualityForSymbols([coin]);
      executionQualityData = qualityMap?.[coin] || null;
    } catch (error) {
      console.log(`[Engine] ${coin} execution quality fetch failed (fail-open): ${error.message}`);
    }

    const executionDecision = applyExecutionQualityAdjustment(nextConfidence, executionQualityData);
    nextConfidence = executionDecision.adjustedConfidence;
    executionAdjustment = executionDecision.adjustment;
    if (executionDecision.shouldBlock) {
      console.log(`[ENGINE] ${coin} BLOCKED -> Illiquid execution conditions (${executionDecision.reason}) | confidence:${nextConfidence}%`);
      return { blocked: true, confidence: nextConfidence, executionAdjustment, executionQualityData };
    }
  }

  return { blocked: false, confidence: nextConfidence, executionAdjustment, executionQualityData };
}

function passQualityGate(coin, confidence, volumeData, momentum, phase = '') {
  const signalQuality = getSignalQuality(confidence);
  if (!signalQuality) {
    console.log(`[Engine] ${coin} skipped -> ${phase}confidence below minimum (${confidence}%)`);
    return { passed: false, signalQuality: null };
  }

  const qualityCheck = runQualityFilters(confidence, volumeData, momentum);
  if (!qualityCheck.passed) {
    console.log(`[Engine] ${coin} skipped -> ${phase}${qualityCheck.reason} (confidence: ${confidence}%)`);
    return { passed: false, signalQuality: null };
  }

  return { passed: true, signalQuality };
}

function applyAiDecisionModes(adjustedSignal) {
  if (!adjustedSignal) return null;

  if (adjustedSignal.blockedByLiquidity) {
    adjustedSignal.aiMessage = `${adjustedSignal.aiMessage || ''} | Liquidity caution advisory (${SIGNAL_LIQUIDITY_REJECT_MODE})`.trim();
  }

  if (adjustedSignal.aiDecision === 'REJECT') {
    adjustedSignal.aiMessage = `${adjustedSignal.aiMessage || ''} | AI reject kept as advisory (${SIGNAL_AI_REJECT_MODE})`.trim();
  }

  return adjustedSignal;
}

function normalizeTradeGrade(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(TRADE_GRADE_RANK, normalized) ? normalized : 'REJECTED';
}

function normalizeContradictionSeverity(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CONTRADICTION_SEVERITY_RANK, normalized) ? normalized : 'SEVERE';
}

function normalizeAgreementStrength(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(AGREEMENT_STRENGTH_RANK, normalized) ? normalized : 'UNKNOWN';
}

function isRegimeBlocked(regime) {
  if (!SIGNAL_BLOCK_UNFAVORABLE_REGIMES) return false;
  const normalized = String(regime || '').trim().toUpperCase();
  if (!normalized) return false;
  return Array.isArray(SIGNAL_BLOCKED_REGIMES) && SIGNAL_BLOCKED_REGIMES.includes(normalized);
}

function evaluateFinalPersistGate(signalData) {
  const reasons = [];

  const regime = String(signalData?.regime || '').trim().toUpperCase();
  if (isRegimeBlocked(regime)) {
    reasons.push(`blocked_regime_${regime}`);
  }

  if (SIGNAL_REQUIRE_TRADE_DECISION_TAKE) {
    const decision = String(signalData?.finalTradeDecision || '').trim().toUpperCase();
    if (decision !== 'TAKE') {
      reasons.push(`final_trade_decision_${decision || 'UNKNOWN'}`);
    }
  }

  const grade = normalizeTradeGrade(signalData?.tradeQualityGrade);
  const minGrade = normalizeTradeGrade(SIGNAL_MIN_TRADE_GRADE);
  if (TRADE_GRADE_RANK[grade] < TRADE_GRADE_RANK[minGrade]) {
    reasons.push(`trade_grade_${grade}_below_${minGrade}`);
  }

  const severity = normalizeContradictionSeverity(signalData?.contradictionSeverity);
  const maxSeverity = normalizeContradictionSeverity(SIGNAL_MAX_CONTRADICTION_SEVERITY);
  if (CONTRADICTION_SEVERITY_RANK[severity] > CONTRADICTION_SEVERITY_RANK[maxSeverity]) {
    reasons.push(`contradiction_${severity}_above_${maxSeverity}`);
  }

  const agreement = normalizeAgreementStrength(signalData?.agreementStrength);
  const minAgreement = normalizeAgreementStrength(SIGNAL_MIN_AGREEMENT_STRENGTH);
  if (AGREEMENT_STRENGTH_RANK[agreement] < AGREEMENT_STRENGTH_RANK[minAgreement]) {
    reasons.push(`agreement_${agreement}_below_${minAgreement}`);
  }

  const finalAiConfidence = Number(signalData?.aiConfidence);
  if (!Number.isFinite(finalAiConfidence) || finalAiConfidence < SIGNAL_MIN_FINAL_AI_CONFIDENCE) {
    reasons.push(`ai_confidence_${Number.isFinite(finalAiConfidence) ? finalAiConfidence : 'NA'}_below_${SIGNAL_MIN_FINAL_AI_CONFIDENCE}`);
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

async function generateSignalForCoin(coin, topCoins = null, btcTrend = 'UNKNOWN', gateCounters = null, runtimeContext = null) {
  const runCheck = await canRunForCoin(coin);
  if (!runCheck.allowed) {
    incrementGateCounter(gateCounters, runCheck.gate);
    return null;
  }

  const tradableSet = runtimeContext?.tradableSet instanceof Set
    ? runtimeContext.tradableSet
    : null;
  const invalidState = runtimeContext?.invalidSymbolState;

  if (invalidState?.quarantinedSymbols instanceof Set && invalidState.quarantinedSymbols.has(coin)) {
    incrementGateCounter(gateCounters, 'invalid_skip');
    warnInvalidSymbolOnce(runtimeContext, `${coin} skipped -> quarantined invalid symbol for current cycle`);
    return null;
  }

  if (tradableSet && tradableSet.size > 0 && !tradableSet.has(coin)) {
    if (invalidState) {
      invalidState.preflightSkipped = Number(invalidState.preflightSkipped || 0) + 1;
      markSymbolQuarantined(runtimeContext, coin);
    }
    incrementGateCounter(gateCounters, 'invalid_skip');
    warnInvalidSymbolOnce(runtimeContext, `${coin} skipped -> not in tradable Binance symbol set`);
    return null;
  }

  let klines;
  try {
    klines = await getKlines(coin, INTERVAL, CANDLE_COUNT);
  } catch (err) {
    if (err?.code === 'INVALID_SYMBOL') {
      markSymbolQuarantined(runtimeContext, coin);
      incrementGateCounter(gateCounters, 'invalid_skip');
      warnInvalidSymbolOnce(runtimeContext, `${coin} skipped -> Binance INVALID_SYMBOL from kline API`);
      return null;
    }
    console.error(`[Engine] ${coin} error -> Failed to fetch klines: ${err.message}`);
    return null;
  }
  if (!klines || klines.length < TREND_CANDLES) {
    console.log(`[Engine] ${coin} skipped -> Insufficient data`);
    return null;
  }
  const futuresData = await getFuturesContext(coin).catch(() => null);
  const realtimeContext = SIGNAL_USE_REALTIME_CONTEXT
    ? getRealtimeSignalContext(coin)
    : null;

  const allCloses = klines.map((k) => k.close);
  const trendCloses = allCloses.slice(-TREND_CANDLES);
  const currentPrice = trendCloses[trendCloses.length - 1];
  const volumeData = checkVolume(klines);
  const volumeDelta = calculateVolumeDelta(klines);

  const setup = resolveSetup(coin, klines, allCloses, trendCloses, currentPrice, gateCounters);
  if (!setup) return null;
  const { advancedSignal, regime } = setup;
  const { trend, trigger } = advancedSignal;

  let macroTrends = null;
  let orderBookLiquidity = null;
  try {
    [macroTrends, orderBookLiquidity] = await Promise.all([
      getMacroTrendSnapshot(),
      getOrderBookLiquidityForSignal(coin, currentPrice, trend)
    ]);
  } catch (error) {
    console.log(`[ENGINE] ${coin} macro/depth context unavailable (fail-open): ${error.message}`);
  }

  const btcPolicy = resolveBtcPenalty(coin, btcTrend, trend);
  if (btcPolicy.blocked) return null;
  const btcConfidencePenalty = btcPolicy.penalty;

  const momentum = calculateMomentum(trendCloses);
  const shortTermMomentum = calculateShortTermMomentum(allCloses);
  const midTermMomentum = calculateMidTermMomentum(allCloses);
  const rsi = calculateRSI(allCloses.slice(-15));
  const prevRsi = calculateRSI(allCloses.slice(-16, -1));
  const rsiHistory = buildRsiHistory(allCloses);
  const macdData = calculateMACD(allCloses);

  const bbData = calculateBollingerBands(allCloses, 20);
  let bbWidthPercent = 0;
  let bbExpanding = false;
  if (bbData) {
    bbWidthPercent = (bbData.upper - bbData.lower) / bbData.middle * 100;
    const prevBbData = calculateBollingerBands(allCloses.slice(0, -1), 20);
    if (prevBbData) bbExpanding = bbData.bandwidth > prevBbData.bandwidth;
  }
  const atr = calculateATR(klines, 14);
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  const adxData = calculateADX(klines, 14);
  const adxContext = evaluateAdxForSignal(trend, adxData, trigger);
  const structureAnalysis = analyzeMarketStructure(klines);
  const structureContext = evaluateStructureForSignal(trend, structureAnalysis);
  const srContext = analyzeSupportResistance(klines, advancedSignal, volumeData);
  const cvdContext = evaluateCvdForSignal(trend, realtimeContext, shortTermMomentum);
  const depthContext = {
    adjustment: Number(orderBookLiquidity?.adjustment || 0),
    flags: Array.isArray(orderBookLiquidity?.flags) ? orderBookLiquidity.flags : []
  };

  const higherTimeframeTrend = await detect4HTrend(coin);
  const higherTrend = higherTimeframeTrend ? higherTimeframeTrend.legacyTrend : null;
  const technicalScore = calcTechnicalScore({
    advancedSignal,
    momentum,
    volumeData,
    volumeDelta,
    rsi,
    macdData,
    bbWidthPercent,
    bbExpanding,
    higherTrend,
    shortTermMomentum,
    midTermMomentum,
    currentPrice
  });
  const regimeContext = detectMarketRegimeAdvanced({
    adxData,
    bbWidthPercent,
    atrPct,
    slope: advancedSignal?.slope || 0,
    structureData: structureAnalysis,
    breakoutSignal: advancedSignal?.trigger === 'VOLATILITY_BREAKOUT',
    bbExpanding
  });
  const liquidationContext = detectLiquidationPressure({
    trend,
    klines,
    atr,
    volumeData,
    futuresData,
    realtimeContext
  });

  if (isRegimeBlocked(regimeContext.regime || regime)) {
    console.log(`[ENGINE] ${coin} blocked -> unfavorable regime ${regimeContext.regime || regime}`);
    incrementGateCounter(gateCounters, 'quality_fail');
    return null;
  }

  const marketScore = await calcMarketScore(coin, trend, topCoins).catch(() => 15);
  const normalizedMarketScore = Math.round((marketScore / 30) * 30);
  const baseConfidence = Math.round(technicalScore * 0.7 + normalizedMarketScore * 0.3);

  const confidenceBoost = calcConfidenceBoost({
    trendData: advancedSignal,
    higherTrend,
    macdData,
    rsi,
    rsiHistory,
    bbExpanding,
    currentPrice
  });
  const confidencePenalty = calcConfidencePenalty({
    rsi,
    volumeData,
    momentum,
    shortTermMomentum,
    midTermMomentum
  });
  let volumeDeltaPenalty = 0;
  if ((trend === 'BUY' && volumeDelta.sellDominant) || (trend === 'SELL' && volumeDelta.buyDominant)) {
    volumeDeltaPenalty = -8;
  }

  if (hasStrongIndicatorConflict({ trend, macdData, currentPrice, shortTermMomentum, midTermMomentum, volumeDelta })) {
    console.log(`[ENGINE] ${coin} BLOCKED -> Strong indicator conflict (MACD + momentum + volume against ${trend})`);
    return null;
  }

  const weakPenalty = calcWeakIndicatorPenalty({
    rsi: getRSIStrengthLevel(rsi),
    macd: getMACDStrengthLevel(macdData, trend, currentPrice),
    momentum: getMomentumStrengthLevel(shortTermMomentum, midTermMomentum, trend),
    volume: getVolumeStrengthLevel(volumeData),
    trend: getTrendStrengthLevel(advancedSignal, currentPrice)
  });

  let confidence = clampConfidence(baseConfidence + confidenceBoost + confidencePenalty + weakPenalty + volumeDeltaPenalty + btcConfidencePenalty);

  const sentimentResult = await calcNewsSentiment(coin, { trend });
  const sentimentScore = Number(sentimentResult?.score || 0);
  const sentimentDirectionalScore = Number(sentimentResult?.directionalScore || 0);
  const sentimentConfidenceAdjustment = calculateSentimentAdjustment(sentimentDirectionalScore);
  confidence = clampConfidence(confidence + sentimentConfidenceAdjustment);

  const futuresAdjustment = SIGNAL_USE_FUTURES_CONTEXT
    ? applyFuturesAdjustment(trend, futuresData)
    : { adjustment: 0, notes: [], score: 0 };
  confidence = clampConfidence(confidence + futuresAdjustment.adjustment);

  const realtimeAdjustment = SIGNAL_USE_REALTIME_CONTEXT
    ? applyRealtimeAdjustment(trend, realtimeContext)
    : { adjustment: 0, notes: [], score: 0 };
  confidence = clampConfidence(confidence + realtimeAdjustment.adjustment);

  const guardrailDecision = applyGuardrailPenalties({
    trend,
    btcTrend,
    higherTimeframeTrend,
    orderBookLiquidity,
    executionQualityData: null,
    macroTrends
  });
  confidence = clampConfidence(confidence + guardrailDecision.penalty);

  const preGateMicroAdjustment = srContext.signalImpact.adjustment
    + adxContext.adjustment
    + structureContext.adjustment
    + regimeContext.adjustment
    + cvdContext.adjustment
    + liquidationContext.adjustment
    + depthContext.adjustment;
  confidence = clampConfidence(confidence + preGateMicroAdjustment);

  const initialGate = passQualityGate(coin, confidence, volumeData, momentum);
  if (!initialGate.passed) {
    incrementGateCounter(gateCounters, 'quality_fail');
    return null;
  }

  const fourH = apply4HGate(coin, trend, confidence, higherTimeframeTrend);
  if (fourH.blocked) {
    incrementGateCounter(gateCounters, 'fourh_block');
    return null;
  }
  confidence = fourH.confidence;

  const execution = await applyExecutionGate(coin, confidence);
  if (execution.blocked) return null;
  confidence = execution.confidence;

  const postExecutionGuardrail = applyGuardrailPenalties({
    trend,
    btcTrend,
    higherTimeframeTrend,
    orderBookLiquidity,
    executionQualityData: execution.executionQualityData,
    macroTrends
  });
  confidence = clampConfidence(confidence + postExecutionGuardrail.penalty);

  const segmentKey = buildSegmentKey({
    trigger,
    regime: regimeContext.regime || regime,
    symbol: coin,
    confidence
  });
  const learningPerformance = await analyzePerformance();
  const segmentAdjustment = getSegmentAdaptiveAdjustment(learningPerformance, segmentKey);
  confidence = clampConfidence(confidence + segmentAdjustment.adjustment);

  const scaleAdjustment = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return parsed * 0.35;
  };
  const confidenceCalibration = calibrateConfidence(confidence, {
    supportResistance: {
      adjustment: scaleAdjustment(srContext.signalImpact.adjustment),
      flags: srContext.signalImpact.flags || []
    },
    adx: {
      adjustment: scaleAdjustment(adxContext.adjustment),
      flags: adxContext.flags || []
    },
    structure: {
      adjustment: scaleAdjustment(structureContext.adjustment),
      flags: structureContext.flags || []
    },
    regime: {
      adjustment: scaleAdjustment(regimeContext.adjustment),
      flags: regimeContext.flags || []
    },
    cvd: {
      adjustment: scaleAdjustment(cvdContext.adjustment),
      flags: cvdContext.flags || []
    },
    liquidation: {
      adjustment: scaleAdjustment(liquidationContext.adjustment),
      flags: liquidationContext.flags || []
    },
    depth: {
      adjustment: scaleAdjustment(depthContext.adjustment),
      flags: depthContext.flags || []
    },
    realtime: {
      adjustment: scaleAdjustment(realtimeAdjustment.adjustment)
    },
    futures: {
      adjustment: scaleAdjustment(futuresAdjustment.adjustment)
    },
    sentimentAdjustment: scaleAdjustment(sentimentConfidenceAdjustment),
    marketGuardrail: {
      adjustment: scaleAdjustment(guardrailDecision.penalty + postExecutionGuardrail.penalty + fourH.fourHPenalty + execution.executionAdjustment)
    },
    segment: {
      adjustment: scaleAdjustment(segmentAdjustment.adjustment)
    }
  }, trend);
  confidence = clampConfidence(confidenceCalibration.finalConfidence);

  const qualityValidator = validateFinalSignalQuality({
    trend,
    confidence,
    regimeContext,
    adxContext,
    structureContext,
    srContext: srContext.signalImpact,
    cvdContext,
    depthContext,
    liquidationContext
  });
  confidence = clampConfidence(confidence + qualityValidator.penalty);
  if (qualityValidator.reject) {
    console.log(`[ENGINE] ${coin} rejected -> final quality validator: ${qualityValidator.reasons.join(', ')}`);
    incrementGateCounter(gateCounters, 'quality_fail');
    return null;
  }

  const finalGate = passQualityGate(coin, confidence, volumeData, momentum, 'Final ');
  if (!finalGate.passed) {
    incrementGateCounter(gateCounters, 'quality_fail');
    return null;
  }
  const signalQuality = finalGate.signalQuality;

  const signalData = buildRiskManagedSignalData(coin, trend, currentPrice, atr, {
    confidence,
    regimeContext,
    supportResistance: srContext,
    liquidationContext,
    legacyRegime: regime
  });
  const executionIntelligence = evaluateExecutionIntelligence({
    signalData,
    trend,
    currentPrice,
    atr,
    regimeContext,
    supportResistance: srContext,
    marketStructure: structureAnalysis,
    structureContext,
    orderBookLiquidity,
    liquidationContext,
    depthContext,
    volumeData,
    momentum,
    adxContext,
    executionQualityData: execution.executionQualityData
  });

  signalData.entryPrice = executionIntelligence.entryPrice;
  signalData.target = executionIntelligence.target;
  signalData.stopLoss = executionIntelligence.stopLoss;
  signalData.executionIntelligence = executionIntelligence;
  signalData.rrAnalysis = executionIntelligence.rrAnalysis;
  signalData.executionRealismScore = executionIntelligence?.scores?.executionRealism ?? null;
  signalData.survivabilityScore = executionIntelligence?.scores?.survivability ?? null;
  signalData.structureStopReason = executionIntelligence?.stop?.reason || null;
  signalData.targetLogicReason = executionIntelligence?.targetModel?.reason || null;
  signalData.tradeQualityGrade = executionIntelligence?.baseTradeQualityGrade || null;
  signalData.riskGrade = executionIntelligence?.riskGrade || null;
  signalData.riskModel = {
    ...(signalData.riskModel || {}),
    realizedRR: executionIntelligence?.rrAnalysis?.ratio ?? signalData?.riskModel?.realizedRR ?? null,
    executionDecisionHint: executionIntelligence?.decisionHint || null
  };
  signalData.validUntil = new Date(Date.now() + SIGNAL_VALIDITY_MS);
  signalData.confidence = confidence;
  signalData.sentimentScore = sentimentScore;
  signalData.newsSummary = `Sentiment:${sentimentScore.toFixed(3)} (${sentimentResult?.label || 'NEUTRAL'})`;
  signalData.sentimentBreakdown = {
    status: sentimentResult?.status || 'FALLBACK',
    source: sentimentResult?.source || 'fallback_neutral',
    directionalScore: Number.isFinite(sentimentDirectionalScore) ? Number(sentimentDirectionalScore.toFixed(4)) : 0,
    adjustment: sentimentConfidenceAdjustment,
    articleCount: Number(sentimentResult?.breakdown?.articleCount || 0),
    articleBias: Number(sentimentResult?.breakdown?.articleBias || 0),
    macroBias: Number(sentimentResult?.breakdown?.macroBias || 0)
  };
  signalData.machineVersion = SIGNAL_MACHINE_VERSION;
  signalData.segmentKey = segmentKey;
  signalData.guardrailFlags = [...new Set([
    ...guardrailDecision.flags,
    ...postExecutionGuardrail.flags,
    ...(srContext.signalImpact.flags || []),
    ...(adxContext.flags || []),
    ...(structureContext.flags || []),
    ...(regimeContext.flags || []),
    ...(cvdContext.flags || []),
    ...(depthContext.flags || []),
    ...(liquidationContext.flags || []),
    ...(qualityValidator.reasons || []),
    ...(segmentAdjustment.applied ? [`SEGMENT:${segmentAdjustment.reason}`] : [])
  ])];
  signalData.signalQuality = signalQuality;
  signalData.macroTrends = macroTrends;
  signalData.orderBookLiquidity = orderBookLiquidity;
  signalData.supportResistance = srContext;
  signalData.marketStructure = structureAnalysis;
  signalData.marketStructureSignal = structureContext;
  signalData.adxContext = adxContext;
  signalData.regimeContext = regimeContext;
  signalData.cvdContext = cvdContext.metrics || null;
  signalData.liquidationContext = liquidationContext;
  signalData.depthContext = {
    adjustment: depthContext.adjustment,
    flags: depthContext.flags,
    persistence: orderBookLiquidity?.depthPersistence || null
  };
  signalData.confidenceCalibration = confidenceCalibration;
  signalData.futuresContext = futuresData ? {
    fundingRate: toNullableNumber(futuresData.fundingRate, 8),
    longShortRatio: toNullableNumber(futuresData.longShortRatio, 4),
    takerBuySellRatio: toNullableNumber(futuresData.takerBuySellRatio, 4),
    openInterest: toNullableNumber(futuresData.openInterest, 4),
    fundingRateAvg: toNullableNumber(futuresData.fundingRateAvg, 8),
    fundingRateTrendPct: toNullableNumber(futuresData.fundingRateTrendPct, 4),
    openInterestTrendPct: toNullableNumber(futuresData.openInterestTrendPct, 4),
    topTraderPositionRatio: toNullableNumber(futuresData.topTraderPositionRatio, 4),
    topTraderAccountRatio: toNullableNumber(futuresData.topTraderAccountRatio, 4),
    crowdingBias: toNullableNumber(futuresData.crowdingBias, 4)
  } : null;
  signalData.realtimeContext = realtimeContext || null;
  signalData.indicators = {
    rsi: toNullableNumber(rsi, 4),
    prevRsi: toNullableNumber(prevRsi, 4),
    ema9: toNullableNumber(advancedSignal?.ema9, 8),
    ema21: toNullableNumber(advancedSignal?.ema21, 8),
    emaSlope: toNullableNumber(advancedSignal?.slope, 6),
    emaProximity: advancedSignal?.proximity || null,
    emaZone: advancedSignal?.zone || null,
    macd: {
      macdLine: toNullableNumber(macdData?.macdLine, 8),
      signalLine: toNullableNumber(macdData?.signalLine, 8),
      histogram: toNullableNumber(macdData?.histogram, 8)
    },
    atr: toNullableNumber(atr, 8),
    atrPct: toNullableNumber(atrPct, 6),
    bbUpper: toNullableNumber(bbData?.upper, 8),
    bbLower: toNullableNumber(bbData?.lower, 8),
    bbMiddle: toNullableNumber(bbData?.middle, 8),
    bbWidthPercent: toNullableNumber(bbWidthPercent, 6),
    bbExpanding,
    volume: toNullableNumber(volumeData?.current, 2),
    volumeAvg: toNullableNumber(volumeData?.average, 2),
    volumeRatio: toNullableNumber(volumeData?.ratio, 6),
    volumeSpike: Boolean(volumeData?.isSpike),
    volumeDeltaRatio: toNullableNumber(volumeDelta?.deltaRatio, 6)
  };
  signalData.confidenceBreakdown = {
    technical: Math.round(technicalScore * 0.7),
    market: normalizedMarketScore,
    sentiment: sentimentScore,
    bonus: confidenceBoost
      + (srContext.signalImpact.adjustment > 0 ? srContext.signalImpact.adjustment : 0)
      + (adxContext.adjustment > 0 ? adxContext.adjustment : 0)
      + (structureContext.adjustment > 0 ? structureContext.adjustment : 0)
      + (regimeContext.adjustment > 0 ? regimeContext.adjustment : 0)
      + (cvdContext.adjustment > 0 ? cvdContext.adjustment : 0)
      + (liquidationContext.adjustment > 0 ? liquidationContext.adjustment : 0)
      + (depthContext.adjustment > 0 ? depthContext.adjustment : 0)
      + (sentimentConfidenceAdjustment > 0 ? sentimentConfidenceAdjustment : 0)
      + (segmentAdjustment.adjustment > 0 ? segmentAdjustment.adjustment : 0)
      + (futuresAdjustment.adjustment > 0 ? futuresAdjustment.adjustment : 0)
      + (realtimeAdjustment.adjustment > 0 ? realtimeAdjustment.adjustment : 0)
      + (confidenceCalibration.breakdown?.contradictionPenalty > 0 ? confidenceCalibration.breakdown.contradictionPenalty : 0),
    penalty: confidencePenalty
      + weakPenalty
      + volumeDeltaPenalty
      + btcConfidencePenalty
      + (srContext.signalImpact.adjustment < 0 ? srContext.signalImpact.adjustment : 0)
      + (adxContext.adjustment < 0 ? adxContext.adjustment : 0)
      + (structureContext.adjustment < 0 ? structureContext.adjustment : 0)
      + (regimeContext.adjustment < 0 ? regimeContext.adjustment : 0)
      + (cvdContext.adjustment < 0 ? cvdContext.adjustment : 0)
      + (liquidationContext.adjustment < 0 ? liquidationContext.adjustment : 0)
      + (depthContext.adjustment < 0 ? depthContext.adjustment : 0)
      + fourH.fourHPenalty
      + execution.executionAdjustment
      + (sentimentConfidenceAdjustment < 0 ? sentimentConfidenceAdjustment : 0)
      + (futuresAdjustment.adjustment < 0 ? futuresAdjustment.adjustment : 0)
      + (realtimeAdjustment.adjustment < 0 ? realtimeAdjustment.adjustment : 0)
      + guardrailDecision.penalty
      + postExecutionGuardrail.penalty
      + qualityValidator.penalty
      + (confidenceCalibration.breakdown?.contradictionPenalty < 0 ? confidenceCalibration.breakdown.contradictionPenalty : 0)
      + (segmentAdjustment.adjustment < 0 ? segmentAdjustment.adjustment : 0)
  };

  const reasons = getReasonLabels(advancedSignal, momentum, volumeData, rsi);
  reasons.rsi = rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi > 55 ? 'BULLISH' : rsi < 45 ? 'BEARISH' : 'NEUTRAL';
  reasons.macd = macdData && macdData.histogram > 0 ? 'BULLISH' : macdData && macdData.histogram < 0 ? 'BEARISH' : 'NEUTRAL';
  reasons.deltaRatio = volumeDelta.deltaRatio.toFixed(2);
  reasons.volumeConfirmed = volumeDelta.buyDominant ? 'BUY_DOMINANT' : volumeDelta.sellDominant ? 'SELL_DOMINANT' : 'NEUTRAL';
  reasons.sentiment = sentimentScore > 0.3 ? 'BULLISH' : sentimentScore < -0.3 ? 'BEARISH' : 'NEUTRAL';
  reasons.execution = execution.executionQualityData?.executionQuality || 'UNKNOWN';
  reasons.slippageRisk = execution.executionQualityData?.slippageRisk || 'UNKNOWN';
  const futuresNote = futuresAdjustment.notes.length > 0 ? futuresAdjustment.notes.join(', ') : 'neutral_futures';
  const realtimeNote = realtimeAdjustment.notes.length > 0 ? realtimeAdjustment.notes.join(', ') : 'neutral_realtime';
  reasons.segment = `${segmentAdjustment.reason || 'neutral_segment'} | F:${futuresNote} | R:${realtimeNote} | ADX:${adxContext.strength} | REG:${regimeContext.regime} | STR:${structureAnalysis.trendBias}`;
  if (orderBookLiquidity) reasons.execution = `${reasons.execution} | OB_R:${orderBookLiquidity.bidAskVolumeRatio.toFixed(2)}`;
  if (cvdContext?.metrics) reasons.execution = `${reasons.execution} | CVD:${cvdContext.metrics.cvd15m}`;
  signalData.reason = reasons;
  signalData.trigger = trigger;
  signalData.regime = regimeContext.regime || regime;
  signalData.higherTimeframeTrend = higherTimeframeTrend ? higherTimeframeTrend.trend : null;

  const signalToAdjust = {
    ...signalData,
    rsi,
    prevRsi,
    futuresData,
    takerBuyVolume: klines[klines.length - 1]?.takerBuyVolume ?? null,
    numberOfTrades: klines[klines.length - 1]?.numberOfTrades ?? null,
    volumeSpike: volumeData.isSpike,
    btcTrend,
    trendStrength: signalQuality,
    isLateEntry: false,
    macroTrends,
    orderBookLiquidity,
    realtimeContext,
    supportResistance: srContext,
    marketStructure: structureAnalysis,
    adxContext,
    regimeContext,
    cvdContext: cvdContext.metrics || null,
    liquidationContext,
    confidenceCalibration,
    executionIntelligence
  };

  const adjustedSignal = await enhancedAnalyze(signalToAdjust);
  if (!adjustedSignal) return null;
  const finalAdjusted = applyAiDecisionModes(adjustedSignal);
  if (!finalAdjusted) return null;

  // `aiScore` remains internal rule+history heuristic; `aiConfidence` is TriCore final confidence.
  signalData.aiScore = finalAdjusted.aiScore;
  signalData.aiConfidence = finalAdjusted.aiConfidence ?? finalAdjusted.aiScore ?? null;
  signalData.aiDecision = finalAdjusted.aiDecision;
  signalData.aiMessage = finalAdjusted.aiMessage;
  signalData.groqTradeCall = finalAdjusted.groqTradeCall ?? null;
  signalData.groqInsight = finalAdjusted.groqInsight ?? '';
  signalData.nvidiaConfidence = finalAdjusted.nvidiaConfidence ?? null;
  signalData.nvidiaTradeCall = finalAdjusted.nvidiaTradeCall ?? null;
  signalData.nvidiaInsight = finalAdjusted.nvidiaInsight ?? '';
  signalData.nvidiaStatus = finalAdjusted.nvidiaStatus || 'SKIPPED';
  signalData.nvidiaAttempts = Number.isFinite(Number(finalAdjusted.nvidiaAttempts)) ? Number(finalAdjusted.nvidiaAttempts) : 0;
  signalData.nvidiaError = finalAdjusted.nvidiaError || null;
  signalData.aiStatus = finalAdjusted.aiStatus || 'SKIPPED';
  signalData.aiAttempts = Number.isFinite(Number(finalAdjusted.aiAttempts)) ? Number(finalAdjusted.aiAttempts) : 0;
  signalData.aiError = finalAdjusted.aiError || null;
  signalData.machineContext = finalAdjusted.machineContext || null;
  signalData.grokValidation = finalAdjusted.grokValidation || null;
  signalData.nvidiaValidation = finalAdjusted.nvidiaValidation || null;
  signalData.triCore = finalAdjusted.triCore || null;
  signalData.finalTradeDecision = finalAdjusted.finalTradeDecision || null;
  signalData.aiAgreementScore = Number.isFinite(Number(finalAdjusted.aiAgreementScore))
    ? Number(finalAdjusted.aiAgreementScore)
    : null;
  signalData.contradictionList = Array.isArray(finalAdjusted.contradictionList)
    ? finalAdjusted.contradictionList
    : [];
  signalData.validatorReasons = Array.isArray(finalAdjusted.validatorReasons)
    ? finalAdjusted.validatorReasons
    : [];
  signalData.finalConfidenceBreakdown = finalAdjusted.finalConfidenceBreakdown || null;
  applyAiRiskPlanToSignalData(signalData, trend, finalAdjusted.aiRiskPlan);

  const executionDecision = finalizeExecutionDecision({
    executionIntelligence: signalData.executionIntelligence,
    triCore: signalData.triCore,
    finalConfidence: signalData.aiConfidence
  });
  signalData.finalTradeDecision = executionDecision.finalDecision;
  signalData.tradeQualityGrade = executionDecision.tradeQualityGrade;
  signalData.tradeDecisionReason = executionDecision.tradeDecisionReason;
  signalData.agreementStrength = executionDecision.agreementStrength;
  signalData.executionRealismScore = executionDecision.executionRealismScore;
  signalData.survivabilityScore = executionDecision.survivabilityScore;
  signalData.contradictionSeverity = executionDecision.contradictionSeverity;
  if (signalData.triCore && typeof signalData.triCore === 'object') {
    signalData.triCore = {
      ...signalData.triCore,
      triCoreDecision: signalData.triCore.finalTradeDecision,
      finalTradeDecision: executionDecision.finalDecision
    };
  }
  signalData.executionIntelligence = {
    ...(signalData.executionIntelligence || {}),
    finalDecision: executionDecision.finalDecision,
    tradeQualityGrade: executionDecision.tradeQualityGrade,
    agreementStrength: executionDecision.agreementStrength,
    contradictionSeverity: executionDecision.contradictionSeverity,
    tradeDecisionReason: executionDecision.tradeDecisionReason
  };

  const persistGate = evaluateFinalPersistGate(signalData);
  if (!persistGate.allowed) {
    console.log(`[ENGINE] ${coin} blocked -> final persist gate: ${persistGate.reasons.join(', ')}`);
    try {
      const existingBlockedSignal = await Signal.findOne({
        coin,
        status: 'BLOCKED',
        result: 'PENDING'
      }).sort({ createdAt: -1 });

      if (existingBlockedSignal) {
        console.log(`[ENGINE] ${coin} blocked signal duplicate skipped -> existing id:${existingBlockedSignal._id}`);
        incrementGateCounter(gateCounters, 'quality_fail');
        return null;
      }

      const blockedAt = new Date();
      const blockedSignal = new Signal({
        ...signalData,
        status: 'BLOCKED',
        result: 'PENDING',
        persistGateReasons: persistGate.reasons,
        persistGateBlockedAt: blockedAt,
        expireAt: new Date(blockedAt.getTime() + BLOCKED_SIGNAL_CLEANUP_TTL_MS)
      });
      await blockedSignal.save();
      console.log(`[ENGINE] ${coin} BLOCKED SIGNAL SAVED -> id:${blockedSignal._id}`);
    } catch (blockedSaveError) {
      console.error(`[ENGINE] ${coin} blocked signal save failed: ${blockedSaveError.message}`);
    }
    incrementGateCounter(gateCounters, 'quality_fail');
    return null;
  }

  const duplicateBeforeSave = await closeExpiredPendingSignals(coin);
  if (duplicateBeforeSave.hasUnresolved) {
    console.log(`[ENGINE] Duplicate signal blocked: active unresolved signal exists for ${coin}`);
    return null;
  }

  const savedSignal = new Signal(signalData);
  await savedSignal.save();

  try {
    await saveTradeSnapshot({
      coin: signalData.coin,
      setup: signalData.trigger,
      rsi: signalData.indicators?.rsi ?? null,
      volumeRatio: signalData.indicators?.volumeRatio ?? null,
      emaSlope: signalData.indicators?.emaSlope ?? null,
      atrPct: signalData.indicators?.atrPct ?? null,
      btcMomentum: signalData.btcTrend ?? null,
      confidence: signalData.confidence,
      aiScore: signalData.aiScore ?? null
    });
  } catch (error) {
    console.error(`[TradeSnapshot] Failed to save snapshot: ${error.message}`);
  }

  lastSignalTimes.set(coin, Date.now());
  console.log(`[ENGINE] ${coin} SIGNAL CREATED -> id:${savedSignal._id} | trigger:${trigger} | ai:${signalData.aiDecision} (${signalData.aiScore})`);

  return savedSignal;
}

module.exports = {
  generateSignalForCoin
};
