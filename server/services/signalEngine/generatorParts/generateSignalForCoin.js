const { getKlines } = require('../../binanceService');
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
  calculateATR
} = require('../analysis');
const {
  buildSignalData,
  getReasonLabels,
  getSignalQuality,
  runQualityFilters,
  applyExecutionQualityAdjustment
} = require('./core');
const { getOrderBookLiquidityForSignal } = require('./orderBook');
const { applyGuardrailPenalties } = require('./guardrails');

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
  SIGNAL_LIQUIDITY_REJECT_MODE,
  SIGNAL_AI_REJECT_MODE,
  SIGNAL_VALIDITY_MS,
  SIGNAL_MACHINE_VERSION
} = settings;

function clampConfidence(value) {
  return Math.max(0, Math.min(100, value));
}

async function canRunForCoin(coin) {
  const activeSignal = await Signal.findOne({ coin, status: 'ACTIVE' });
  if (activeSignal) {
    if (activeSignal.validUntil && new Date(activeSignal.validUntil).getTime() <= Date.now()) {
      await Signal.findByIdAndUpdate(activeSignal._id, {
        status: 'CLOSED',
        result: 'EXPIRED',
        closedAt: new Date()
      });
      console.log(`[ENGINE] ${coin} stale ACTIVE signal auto-closed -> EXPIRED`);
      return true;
    }
    console.log(`[ENGINE] ${coin} skipped -> Active signal exists`);
    return false;
  }

  if (COOLDOWN_MS <= 0) {
    return true;
  }

  const recentSignal = await Signal.findOne({
    coin,
    createdAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
  }).sort({ createdAt: -1 });

  if (recentSignal) {
    const elapsed = Date.now() - recentSignal.createdAt.getTime();
    const mins = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
    console.log(`[ENGINE] ${coin} skipped -> Recent signal exists (${mins}m ago)`);
    return false;
  }

  const lastTime = lastSignalTimes.get(coin);
  if (lastTime) {
    const elapsed = Date.now() - lastTime;
    const remaining = COOLDOWN_MS - elapsed;
    if (remaining > 0) {
      console.log(`[ENGINE] ${coin} skipped -> Cooldown (${Math.ceil(remaining / 60000)}m remaining)`);
      return false;
    }
  }

  return true;
}

function resolveSetup(coin, klines, allCloses, trendCloses, currentPrice) {
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
    console.log(`[Engine] ${coin} BUY signal penalized (-25) by BTC Strong Bearish trend`);
    return { blocked: false, penalty: -25 };
  }

  if (btcTrend.includes('BULLISH') && trend === 'SELL') {
    console.log(`[Engine] ${coin} SELL signal penalized (-20) by BTC Bullish trend`);
    return { blocked: false, penalty: -20 };
  }

  if (btcTrend === 'BEARISH' && trend === 'BUY') {
    console.log(`[Engine] ${coin} BUY signal penalized (-15) by BTC Bearish trend`);
    return { blocked: false, penalty: -15 };
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

async function generateSignalForCoin(coin, topCoins = null, btcTrend = 'UNKNOWN') {
  if (!(await canRunForCoin(coin))) return null;

  let klines;
  try {
    klines = await getKlines(coin, INTERVAL, CANDLE_COUNT);
  } catch (err) {
    console.error(`[Engine] ${coin} error -> Failed to fetch klines: ${err.message}`);
    return null;
  }
  if (!klines || klines.length < TREND_CANDLES) {
    console.log(`[Engine] ${coin} skipped -> Insufficient data`);
    return null;
  }

  const allCloses = klines.map((k) => k.close);
  const trendCloses = allCloses.slice(-TREND_CANDLES);
  const currentPrice = trendCloses[trendCloses.length - 1];
  const volumeData = checkVolume(klines);
  const volumeDelta = calculateVolumeDelta(klines);

  const setup = resolveSetup(coin, klines, allCloses, trendCloses, currentPrice);
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

  const guardrailDecision = applyGuardrailPenalties({
    trend,
    btcTrend,
    higherTimeframeTrend,
    orderBookLiquidity,
    executionQualityData: null,
    macroTrends
  });
  confidence = clampConfidence(confidence + guardrailDecision.penalty);

  const initialGate = passQualityGate(coin, confidence, volumeData, momentum);
  if (!initialGate.passed) return null;

  const fourH = apply4HGate(coin, trend, confidence, higherTimeframeTrend);
  if (fourH.blocked) return null;
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
    regime,
    symbol: coin,
    confidence
  });
  const learningPerformance = await analyzePerformance();
  const segmentAdjustment = getSegmentAdaptiveAdjustment(learningPerformance, segmentKey);
  confidence = clampConfidence(confidence + segmentAdjustment.adjustment);

  const finalGate = passQualityGate(coin, confidence, volumeData, momentum, 'Final ');
  if (!finalGate.passed) return null;
  const signalQuality = finalGate.signalQuality;

  const atr = calculateATR(klines, 14);
  const signalData = buildSignalData(coin, trend, currentPrice, atr);
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
    ...(segmentAdjustment.applied ? [`SEGMENT:${segmentAdjustment.reason}`] : [])
  ])];
  signalData.signalQuality = signalQuality;
  signalData.macroTrends = macroTrends;
  signalData.orderBookLiquidity = orderBookLiquidity;
  signalData.confidenceBreakdown = {
    technical: Math.round(technicalScore * 0.7),
    market: normalizedMarketScore,
    sentiment: sentimentScore,
    bonus: confidenceBoost + (sentimentConfidenceAdjustment > 0 ? sentimentConfidenceAdjustment : 0) + (segmentAdjustment.adjustment > 0 ? segmentAdjustment.adjustment : 0),
    penalty: confidencePenalty
      + weakPenalty
      + volumeDeltaPenalty
      + btcConfidencePenalty
      + fourH.fourHPenalty
      + execution.executionAdjustment
      + (sentimentConfidenceAdjustment < 0 ? sentimentConfidenceAdjustment : 0)
      + guardrailDecision.penalty
      + postExecutionGuardrail.penalty
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
  reasons.segment = segmentAdjustment.reason || 'neutral_segment';
  if (orderBookLiquidity) reasons.execution = `${reasons.execution} | OB_R:${orderBookLiquidity.bidAskVolumeRatio.toFixed(2)}`;
  signalData.reason = reasons;
  signalData.trigger = trigger;
  signalData.regime = regime;
  signalData.higherTimeframeTrend = higherTimeframeTrend ? higherTimeframeTrend.trend : null;

  const signalToAdjust = {
    ...signalData,
    rsi,
    prevRsi,
    volumeSpike: volumeData.isSpike,
    btcTrend,
    trendStrength: signalQuality,
    isLateEntry: false,
    macroTrends,
    orderBookLiquidity
  };

  const adjustedSignal = await enhancedAnalyze(signalToAdjust);
  if (!adjustedSignal) return null;
  const finalAdjusted = applyAiDecisionModes(adjustedSignal);
  if (!finalAdjusted) return null;

  // `aiScore` remains internal rule+history heuristic, `aiConfidence` stores Grok probability score.
  signalData.aiScore = finalAdjusted.aiScore;
  signalData.aiConfidence = finalAdjusted.aiConfidence ?? finalAdjusted.aiScore ?? null;
  signalData.aiDecision = finalAdjusted.aiDecision;
  signalData.aiMessage = finalAdjusted.aiMessage;
  signalData.groqInsight = finalAdjusted.groqInsight ?? '';
  signalData.aiStatus = finalAdjusted.aiStatus || 'SKIPPED';
  signalData.aiAttempts = Number.isFinite(Number(finalAdjusted.aiAttempts)) ? Number(finalAdjusted.aiAttempts) : 0;
  signalData.aiError = finalAdjusted.aiError || null;

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
