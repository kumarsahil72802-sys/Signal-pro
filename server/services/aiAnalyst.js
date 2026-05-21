const { analyzePerformance } = require('./aiLearning');
const { askGroqWithMeta } = require('./groqService');
const { askNvidiaWithMeta } = require('./nvidiaService');
const { settings } = require('./signalEngine/config');
const { buildMachineContext } = require('./signalEngine/generatorParts/machineContext');
const {
  normalizeAiValidation,
  buildUnavailableValidation,
  createTriCoreDecision
} = require('./signalEngine/generatorParts/triCoreEngine');

const {
  SIGNAL_AI_MODE,
  SIGNAL_AI_ENRICHMENT_TIMING,
  SIGNAL_AI_RETRY_COUNT,
  SIGNAL_AI_RETRY_BACKOFF_MS,
  SIGNAL_AI_TIMEOUT_MS,
  SIGNAL_AI_TRIGGER_MIN_CONFIDENCE
} = settings;

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeTradeCall(rawValue) {
  if (rawValue == null) return null;
  const normalized = String(rawValue).trim().toUpperCase();
  if (['TAKE', 'WAIT', 'SKIP'].includes(normalized)) return normalized;
  return null;
}

function normalizeAiDecisionFromTrade(tradeDecision) {
  if (tradeDecision === 'TAKE') return 'STRONG_APPROVE';
  if (tradeDecision === 'WAIT') return 'WEAK_APPROVE';
  return 'REJECT';
}

function parseAiConfidenceScore(rawValue) {
  if (rawValue == null) return null;

  const normalized = String(rawValue).trim();
  if (!normalized) return null;

  const directNumber = Number(normalized);
  if (Number.isFinite(directNumber)) {
    return clampScore(directNumber);
  }

  const firstMatch = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!firstMatch) return null;

  const parsed = Number(firstMatch[0]);
  if (!Number.isFinite(parsed)) return null;
  return clampScore(parsed);
}

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function roundPrice(value, decimals) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function resolveRegimeMinRr(regime = '') {
  switch (String(regime || '').toUpperCase()) {
    case 'BREAKOUT':
      return 1.4;
    case 'TRENDING':
      return 1.35;
    case 'HIGH_VOLATILITY':
      return 1.3;
    case 'LOW_VOLATILITY':
      return 1.2;
    case 'CHOPPY':
      return 1.2;
    case 'RANGING':
    default:
      return 1.2;
  }
}

function isDirectionalPricesValid(trend, entryPrice, targetPrice, stopLossPrice) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(targetPrice) || !Number.isFinite(stopLossPrice)) return false;
  if (trend === 'BUY') return targetPrice > entryPrice && stopLossPrice < entryPrice;
  if (trend === 'SELL') return targetPrice < entryPrice && stopLossPrice > entryPrice;
  return false;
}

function buildAiRiskCandidate(source, targetPrice, stopLossPrice, context = {}) {
  const {
    trend,
    entryPrice,
    atr,
    minRequiredRr,
    machineRisk,
    machineReward
  } = context;

  if (!isDirectionalPricesValid(trend, entryPrice, targetPrice, stopLossPrice)) {
    return null;
  }

  const risk = Math.abs(entryPrice - stopLossPrice);
  const reward = Math.abs(targetPrice - entryPrice);
  if (!(risk > 0) || !(reward > 0)) return null;

  const rr = reward / risk;
  const safeAtr = Number.isFinite(atr) && atr > 0 ? atr : entryPrice * 0.0055;
  const minStopDistance = Math.max(safeAtr * 0.45, entryPrice * 0.001);
  const maxStopDistance = Math.max(safeAtr * 4.2, entryPrice * 0.06);
  const maxTargetDistance = Math.max(safeAtr * 8, entryPrice * 0.14);

  if (risk < minStopDistance || risk > maxStopDistance) return null;
  if (reward > maxTargetDistance) return null;

  if (Number.isFinite(machineRisk) && machineRisk > 0 && risk < machineRisk * 0.45) return null;
  if (Number.isFinite(machineReward) && machineReward > 0 && reward > machineReward * 2.6) return null;
  if (rr < minRequiredRr) return null;

  return {
    source,
    targetPrice,
    stopLossPrice,
    rr,
    risk,
    reward
  };
}

function resolveAiRiskPlan(params = {}) {
  const {
    trend,
    entryPrice,
    machineTarget,
    machineStopLoss,
    regime,
    atr,
    grokValidation,
    nvidiaValidation
  } = params;

  const safeEntry = toFiniteNumber(entryPrice);
  if (!Number.isFinite(safeEntry) || safeEntry <= 0) {
    return { applied: false, reason: 'invalid_entry_price' };
  }

  const decimals = resolvePriceDecimals(safeEntry);
  const minRequiredRr = resolveRegimeMinRr(regime);
  const machineRisk = Math.abs(safeEntry - toFiniteNumber(machineStopLoss, safeEntry));
  const machineReward = Math.abs(toFiniteNumber(machineTarget, safeEntry) - safeEntry);

  const context = {
    trend,
    entryPrice: safeEntry,
    atr: toFiniteNumber(atr, safeEntry * 0.0055),
    minRequiredRr,
    machineRisk,
    machineReward
  };

  const grokCandidate = buildAiRiskCandidate(
    'grok',
    toFiniteNumber(grokValidation?.target_price),
    toFiniteNumber(grokValidation?.stop_loss_price),
    context
  );
  const nvidiaCandidate = buildAiRiskCandidate(
    'nvidia',
    toFiniteNumber(nvidiaValidation?.target_price),
    toFiniteNumber(nvidiaValidation?.stop_loss_price),
    context
  );

  const candidates = [grokCandidate, nvidiaCandidate].filter(Boolean);
  if (grokCandidate && nvidiaCandidate) {
    const consensusTarget = (grokCandidate.targetPrice + nvidiaCandidate.targetPrice) / 2;
    const consensusStop = (grokCandidate.stopLossPrice + nvidiaCandidate.stopLossPrice) / 2;
    const consensusCandidate = buildAiRiskCandidate('consensus', consensusTarget, consensusStop, context);
    if (consensusCandidate) candidates.push(consensusCandidate);
  }

  if (candidates.length === 0) {
    return { applied: false, reason: 'no_valid_ai_target_stop' };
  }

  candidates.sort((a, b) => b.rr - a.rr);
  const winner = candidates[0];

  return {
    applied: true,
    source: winner.source,
    targetPrice: roundPrice(winner.targetPrice, decimals),
    stopLossPrice: roundPrice(winner.stopLossPrice, decimals),
    rr: Number(winner.rr.toFixed(3)),
    minRequiredRr
  };
}

function deriveDecision(score, forceReject = false) {
  if (forceReject) return 'REJECT';
  if (score >= 75) return 'STRONG_APPROVE';
  if (score >= 60) return 'APPROVE';
  if (score >= 50) return 'WEAK_APPROVE';
  return 'REJECT';
}

function formatValue(value) {
  if (value == null || value === '') return 'N/A';
  return String(value);
}

function applyMacroAdjustments(signal) {
  const macro = signal.macroTrends;
  if (!macro) return { delta: 0, notes: [] };

  const notes = [];
  let delta = 0;

  if (signal.type === 'BUY') {
    if (macro.dxy?.direction === 'UP') {
      const dxyPenalty = macro.dxy.strength === 'STRONG' ? -12 : -6;
      delta += dxyPenalty;
      notes.push(`Macro Pressure: DXY ${macro.dxy.trend}`);
    }

    if (macro.sp500?.direction === 'DOWN') {
      const spPenalty = macro.sp500.strength === 'STRONG' ? -10 : -5;
      delta += spPenalty;
      notes.push(`Risk-Off Macro: S&P 500 ${macro.sp500.trend}`);
    }
  }

  if (signal.type === 'SELL') {
    if (macro.dxy?.direction === 'UP' && macro.dxy.strength === 'STRONG') {
      delta += 4;
      notes.push('Macro Tailwind: DXY strength supports SELL');
    }

    if (macro.sp500?.direction === 'DOWN' && macro.sp500.strength === 'STRONG') {
      delta += 4;
      notes.push('Macro Tailwind: S&P 500 weakness supports SELL');
    }
  }

  return { delta, notes };
}

function applyOrderBookAdjustments(signal) {
  const liquidity = signal.orderBookLiquidity;
  if (!liquidity) {
    return { delta: 0, notes: [], blockedByLiquidity: false };
  }

  const notes = [];
  let delta = 0;
  let blockedByLiquidity = false;

  const ratio = Number(liquidity.bidAskVolumeRatio);
  if (Number.isFinite(ratio)) {
    if (signal.type === 'BUY') {
      if (ratio < 0.75) {
        delta -= 10;
        notes.push(`Order-book imbalance: weak bids (ratio ${ratio.toFixed(2)})`);
      } else if (ratio < 1) {
        delta -= 5;
        notes.push(`Order-book caution: ask heavy (ratio ${ratio.toFixed(2)})`);
      } else if (ratio > 1.35) {
        delta += 5;
        notes.push(`Order-book support: bid dominant (ratio ${ratio.toFixed(2)})`);
      }
    }

    if (signal.type === 'SELL') {
      if (ratio > 1.4) {
        delta -= 7;
        notes.push(`Order-book imbalance: weak asks for SELL (ratio ${ratio.toFixed(2)})`);
      } else if (ratio < 0.85) {
        delta += 4;
        notes.push(`Order-book support: ask dominant (ratio ${ratio.toFixed(2)})`);
      }
    }
  }

  if (signal.type === 'BUY' && liquidity.massiveAskWallDetected) {
    delta -= 15;
    notes.push('Whale Wall Detected above entry');

    const askWallPressurePct = Number(liquidity.askWallPressurePct);
    const aggressiveWallPressure = Number.isFinite(askWallPressurePct) && askWallPressurePct >= 60;
    const dangerousImbalance = Number.isFinite(ratio) && ratio < 0.7;

    if (aggressiveWallPressure || dangerousImbalance || liquidity.blockedByLiquidity === true) {
      blockedByLiquidity = true;
      notes.push('BLOCKED BY LIQUIDITY');
    }
  }

  if (signal.type === 'SELL' && liquidity.massiveBidWallDetected) {
    delta -= 8;
    notes.push('BUY wall below entry may squeeze SELL setup');
  }

  return { delta, notes, blockedByLiquidity };
}

function analyzeSignal(signal) {
  if (!signal) return null;

  let score = 50;
  const message = [];

  if (signal.trendStrength === 'STRONG') {
    score += 15;
    message.push('Strong trend');
  } else if (signal.trendStrength === 'WEAK') {
    score -= 10;
    message.push('Weak trend');
  }

  if (signal.isLateEntry) {
    score -= 20;
    message.push('Late entry risk');
  }

  if (signal.volumeSpike) {
    score += 10;
    message.push('Volume supports move');
  }

  if (signal.btcTrend === 'STRONG_BEARISH' && signal.type === 'BUY') {
    score -= 15;
    message.push('BTC against trade');
  }

  if (signal.rsi !== undefined) {
    if (signal.type === 'BUY' && signal.rsi >= 30 && signal.rsi <= 50) {
      score += 8;
      message.push('RSI in BUY zone');
    } else if (signal.type === 'SELL' && signal.rsi >= 50 && signal.rsi <= 70) {
      score += 8;
      message.push('RSI in SELL zone');
    } else if ((signal.type === 'BUY' && signal.rsi > 70) || (signal.type === 'SELL' && signal.rsi < 30)) {
      score -= 10;
      message.push('RSI against trade');
    }
  }

  if (signal.confidence >= 80) {
    score += 8;
    message.push('High confidence signal');
  } else if (signal.confidence < 65) {
    score -= 5;
    message.push('Low confidence');
  }

  if (signal.trigger === 'VOLATILITY_BREAKOUT') {
    score += 5;
    message.push('Breakout trigger');
  } else if (signal.trigger === 'CROSSOVER') {
    score += 5;
    message.push('EMA crossover');
  }

  const macroAdjustments = applyMacroAdjustments(signal);
  score += macroAdjustments.delta;
  message.push(...macroAdjustments.notes);

  const orderBookAdjustments = applyOrderBookAdjustments(signal);
  score += orderBookAdjustments.delta;
  message.push(...orderBookAdjustments.notes);

  score = clampScore(score);
  const decision = deriveDecision(score, orderBookAdjustments.blockedByLiquidity);

  return {
    ...signal,
    aiScore: score,
    aiDecision: decision,
    aiMessage: message.join(' | '),
    blockedByLiquidity: orderBookAdjustments.blockedByLiquidity
  };
}

function buildPerformanceContext(perf, signal) {
  if (!perf || !signal) return 'N/A';
  const trigger = String(signal.trigger || 'UNKNOWN').toUpperCase();
  const symbol = String(signal.coin || '').toUpperCase();

  const triggerPerf = perf.triggerStats?.[trigger];
  const triggerWin = Number(triggerPerf?.win || 0);
  const triggerLoss = Number(triggerPerf?.loss || 0);
  const triggerTotal = triggerWin + triggerLoss;
  const triggerRate = triggerTotal > 0 ? ((triggerWin / triggerTotal) * 100).toFixed(1) : 'N/A';

  const symbolPerf = perf.triggerSymbolStats?.[trigger]?.[symbol];
  const symbolWin = Number(symbolPerf?.win || 0);
  const symbolLoss = Number(symbolPerf?.loss || 0);
  const symbolTotal = symbolWin + symbolLoss;
  const symbolRate = symbolTotal > 0 ? ((symbolWin / symbolTotal) * 100).toFixed(1) : 'N/A';

  return `Trigger(${trigger}) W/L:${triggerWin}/${triggerLoss} WinRate:${triggerRate}% | Coin+Trigger(${symbol}) W/L:${symbolWin}/${symbolLoss} WinRate:${symbolRate}%`;
}

function buildEnrichmentPrompt(_analyzed, machineContext, performanceContext) {
  return `You are a strict crypto signal validation engine.
Role: validate the machine signal against market context, detect contradictions, and issue a trading verdict.

Return STRICT JSON ONLY with this exact schema:
{"ai_confidence":0,"agreement_score":0,"validator_decision":"AGREE|PARTIAL|DISAGREE","trade_decision":"TAKE|WAIT|SKIP","major_contradictions":[],"minor_risks":[],"confidence_adjustment":0,"target_price":0,"stop_loss_price":0,"summary":"max 30 words"}

Validation rules:
1) Compare machine confidence versus context quality.
2) Detect contradictions: fake breakout, weak trend, poor RR, weak liquidity, CVD divergence, regime mismatch.
3) If 2 or more major contradictions exist, avoid TAKE.
4) Keep summary <= 30 words.
5) Return target_price and stop_loss_price only if they improve setup quality; otherwise return null.
6) No markdown, no explanation, no extra keys.

Recent strategy performance:
${performanceContext}

Machine context JSON:
${JSON.stringify(machineContext)}`;
}

function parseAiValidatorPayload(rawText, provider = 'unknown') {
  if (!rawText) return null;
  const text = String(rawText).trim();

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (_nestedError) {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const confidence = parseAiConfidenceScore(parsed.ai_confidence);
  const agreement = parseAiConfidenceScore(parsed.agreement_score);
  const normalized = normalizeAiValidation({
    ai_confidence: confidence,
    agreement_score: agreement,
    validator_decision: parsed.validator_decision,
    trade_decision: parsed.trade_decision,
    major_contradictions: parsed.major_contradictions,
    minor_risks: parsed.minor_risks,
    confidence_adjustment: parsed.confidence_adjustment,
    target_price: parsed.target_price,
    stop_loss_price: parsed.stop_loss_price,
    summary: parsed.summary
  }, provider);

  return normalized;
}

async function runValidator(provider, askFn, prompt) {
  const request = await askFn(prompt, null, {
    retryCount: SIGNAL_AI_RETRY_COUNT,
    retryBackoffMs: SIGNAL_AI_RETRY_BACKOFF_MS,
    timeoutMs: SIGNAL_AI_TIMEOUT_MS
  });

  const parsed = parseAiValidatorPayload(request.text, provider);
  if (parsed) {
    return {
      status: 'SUCCESS',
      attempts: request.attempts || 0,
      error: null,
      validation: parsed
    };
  }

  return {
    status: 'FALLBACK',
    attempts: request.attempts || 0,
    error: request.error || 'invalid_ai_response_payload',
    validation: buildUnavailableValidation(provider, request.error || 'invalid_ai_response_payload')
  };
}

async function enhancedAnalyze(signal, runtime = {}) {
  const analyzed = analyzeSignal(signal);
  if (!analyzed) return null;

  const analyzePerformanceFn = typeof runtime.analyzePerformance === 'function'
    ? runtime.analyzePerformance
    : analyzePerformance;
  const askGroqWithMetaFn = typeof runtime.askGroqWithMeta === 'function'
    ? runtime.askGroqWithMeta
    : askGroqWithMeta;
  const askNvidiaWithMetaFn = typeof runtime.askNvidiaWithMeta === 'function'
    ? runtime.askNvidiaWithMeta
    : askNvidiaWithMeta;

  const perf = await analyzePerformanceFn();
  if (perf) {
    const trigger = String(analyzed.trigger || 'UNKNOWN').toUpperCase();
    const symbol = String(analyzed.coin || '').toUpperCase();
    const triggerPerf = perf.triggerStats?.[trigger];

    if (triggerPerf) {
      const triggerTotal = triggerPerf.win + triggerPerf.loss;
      const triggerWinRate = triggerTotal > 0
        ? Math.round((triggerPerf.win / triggerTotal) * 100)
        : 0;

      if (triggerTotal >= 8 && triggerWinRate < 40) {
        analyzed.aiScore = Math.max(0, analyzed.aiScore - 10);
        analyzed.aiMessage += ' | Low win trigger';
      } else if (triggerTotal >= 8 && triggerWinRate > 65) {
        analyzed.aiScore = Math.min(100, analyzed.aiScore + 10);
        analyzed.aiMessage += ' | High win trigger';
      }
    }

    const symbolPerf = perf.triggerSymbolStats?.[trigger]?.[symbol];
    if (symbolPerf) {
      const symbolTotal = symbolPerf.win + symbolPerf.loss;
      const symbolWinRate = symbolTotal > 0
        ? Math.round((symbolPerf.win / symbolTotal) * 100)
        : 0;

      if (symbolTotal >= 6 && symbolWinRate < 40) {
        analyzed.aiScore = Math.max(0, analyzed.aiScore - 8);
        analyzed.aiMessage += ' | Coin-trigger mismatch';
      } else if (symbolTotal >= 6 && symbolWinRate > 68) {
        analyzed.aiScore = Math.min(100, analyzed.aiScore + 6);
        analyzed.aiMessage += ' | Coin-trigger edge';
      }
    }
  }

  analyzed.aiScore = clampScore(analyzed.aiScore);

  const validatorReasons = Array.isArray(analyzed.guardrailFlags)
    ? [...new Set(analyzed.guardrailFlags)]
    : [];

  const machineContext = buildMachineContext({
    coin: analyzed.coin,
    trend: analyzed.type,
    signalData: analyzed,
    machineConfidence: analyzed.confidence,
    technicalScore: analyzed.confidenceBreakdown?.technical,
    marketScore: analyzed.confidenceBreakdown?.market,
    rsi: analyzed.rsi,
    macdData: analyzed.indicators?.macd || {
      macdLine: null,
      signalLine: null,
      histogram: null
    },
    advancedSignal: {
      ema9: analyzed.indicators?.ema9,
      ema21: analyzed.indicators?.ema21,
      slope: analyzed.indicators?.emaSlope,
      proximity: analyzed.indicators?.emaProximity,
      zone: analyzed.indicators?.emaZone
    },
    atr: analyzed.atr,
    atrPct: analyzed.indicators?.atrPct,
    bbData: {
      upper: analyzed.indicators?.bbUpper,
      lower: analyzed.indicators?.bbLower,
      middle: analyzed.indicators?.bbMiddle
    },
    bbWidthPercent: analyzed.indicators?.bbWidthPercent,
    bbExpanding: analyzed.indicators?.bbExpanding,
    volumeData: {
      ratio: analyzed.indicators?.volumeRatio,
      current: analyzed.indicators?.volume,
      average: analyzed.indicators?.volumeAvg,
      isSpike: analyzed.volumeSpike
    },
    volumeDelta: {
      deltaRatio: Number(analyzed.reason?.deltaRatio),
      buyDominant: analyzed.reason?.volumeConfirmed === 'BUY_DOMINANT',
      sellDominant: analyzed.reason?.volumeConfirmed === 'SELL_DOMINANT'
    },
    srContext: analyzed.supportResistance,
    adxContext: analyzed.adxContext,
    structureAnalysis: analyzed.marketStructure,
    structureContext: analyzed.marketStructureSignal,
    regimeContext: analyzed.regimeContext,
    cvdContext: analyzed.cvdContext ? {
      metrics: analyzed.cvdContext,
      divergence: analyzed.cvdContext?.divergence !== 'NONE',
      aligned: analyzed.cvdContext?.divergence === 'NONE'
    } : null,
    liquidationContext: analyzed.liquidationContext,
    orderBookLiquidity: analyzed.orderBookLiquidity,
    depthContext: analyzed.depthContext,
    futuresData: analyzed.futuresData,
    realtimeContext: analyzed.realtimeContext,
    sentimentResult: {
      label: analyzed.sentimentScore > 0.3 ? 'BULLISH' : analyzed.sentimentScore < -0.3 ? 'BEARISH' : 'NEUTRAL',
      source: analyzed.sentimentBreakdown?.source || 'unknown'
    },
    sentimentScore: analyzed.sentimentScore,
    riskModel: analyzed.riskModel,
    rrAnalysis: analyzed.rrAnalysis,
    executionIntelligence: analyzed.executionIntelligence,
    tradeQualityGrade: analyzed.tradeQualityGrade,
    riskGrade: analyzed.riskGrade,
    validatorReasons,
    machineValidatorPassed: analyzed.aiScore >= 50,
    machineValidatorScore: analyzed.aiScore,
    machineValidatorDecision: deriveDecision(analyzed.aiScore, analyzed.blockedByLiquidity === true)
  });

  const performanceContext = buildPerformanceContext(perf, analyzed);
  const enrichmentPrompt = buildEnrichmentPrompt(analyzed, machineContext, performanceContext);

  let grokResult = {
    status: 'SKIPPED',
    attempts: 0,
    error: 'skipped',
    validation: buildUnavailableValidation('grok', 'skipped')
  };
  let nvidiaResult = {
    status: 'SKIPPED',
    attempts: 0,
    error: 'skipped',
    validation: buildUnavailableValidation('nvidia', 'skipped')
  };

  const shouldRunSyncEnrichment = SIGNAL_AI_ENRICHMENT_TIMING === 'SYNC';
  const machineConfidence = Number(analyzed.confidence);
  const passTrigger = Number.isFinite(machineConfidence) && machineConfidence >= SIGNAL_AI_TRIGGER_MIN_CONFIDENCE;

  if (shouldRunSyncEnrichment && passTrigger) {
    [grokResult, nvidiaResult] = await Promise.all([
      runValidator('grok', askGroqWithMetaFn, enrichmentPrompt),
      runValidator('nvidia', askNvidiaWithMetaFn, enrichmentPrompt)
    ]);
  } else {
    const skipReason = !shouldRunSyncEnrichment ? 'sync_enrichment_disabled' : `invalid_machine_confidence_threshold_${SIGNAL_AI_TRIGGER_MIN_CONFIDENCE}`;
    grokResult = {
      status: 'SKIPPED',
      attempts: 0,
      error: skipReason,
      validation: buildUnavailableValidation('grok', skipReason)
    };
    nvidiaResult = {
      status: 'SKIPPED',
      attempts: 0,
      error: skipReason,
      validation: buildUnavailableValidation('nvidia', skipReason)
    };
  }

  const triCore = createTriCoreDecision({
    machineContext,
    grokValidation: grokResult.validation,
    nvidiaValidation: nvidiaResult.validation
  });
  const aiRiskPlan = resolveAiRiskPlan({
    trend: analyzed.type,
    entryPrice: analyzed.entryPrice,
    machineTarget: analyzed.target,
    machineStopLoss: analyzed.stopLoss,
    regime: analyzed.regimeContext?.regime || analyzed.regime,
    atr: analyzed.indicators?.atr,
    grokValidation: triCore.grok,
    nvidiaValidation: triCore.nvidia
  });

  analyzed.aiConfidence = triCore.finalConfidence;
  analyzed.aiDecision = normalizeAiDecisionFromTrade(triCore.finalTradeDecision);
  analyzed.aiMessage = `${triCore.summary} | ${formatValue(triCore.contradictionList.slice(0, 3).join(', ') || 'no critical contradictions')}`;
  analyzed.aiStatus = grokResult.status;
  analyzed.aiAttempts = grokResult.attempts;
  analyzed.aiError = grokResult.error === 'skipped' ? null : grokResult.error;
  analyzed.groqTradeCall = normalizeTradeCall(triCore.grok.trade_decision);
  analyzed.groqInsight = triCore.grok.summary || '';

  analyzed.nvidiaConfidence = triCore.nvidia.ai_confidence;
  analyzed.nvidiaTradeCall = normalizeTradeCall(triCore.nvidia.trade_decision);
  analyzed.nvidiaInsight = triCore.nvidia.summary || '';
  analyzed.nvidiaStatus = nvidiaResult.status;
  analyzed.nvidiaAttempts = nvidiaResult.attempts;
  analyzed.nvidiaError = nvidiaResult.error === 'skipped' ? null : nvidiaResult.error;

  analyzed.machineContext = machineContext;
  analyzed.grokValidation = {
    ...triCore.grok,
    status: grokResult.status,
    attempts: grokResult.attempts,
    error: grokResult.error
  };
  analyzed.nvidiaValidation = {
    ...triCore.nvidia,
    status: nvidiaResult.status,
    attempts: nvidiaResult.attempts,
    error: nvidiaResult.error
  };
  analyzed.triCore = {
    finalConfidence: triCore.finalConfidence,
    finalTradeDecision: triCore.finalTradeDecision,
    agreementScore: triCore.agreementScore,
    contradictionList: triCore.contradictionList,
    majorContradictions: triCore.majorContradictions,
    minorRisks: triCore.minorRisks,
    reliability: triCore.reliability
  };
  analyzed.aiRiskPlan = aiRiskPlan;
  analyzed.finalTradeDecision = triCore.finalTradeDecision;
  analyzed.aiAgreementScore = triCore.agreementScore;
  analyzed.contradictionList = triCore.contradictionList;
  analyzed.validatorReasons = machineContext.validatorReasons;
  analyzed.finalConfidenceBreakdown = triCore.confidenceBreakdown;

  if (SIGNAL_AI_MODE !== 'GATED') {
    analyzed.aiMessage = `${analyzed.aiMessage} | mode:${SIGNAL_AI_MODE}`;
  }

  return analyzed;
}

module.exports = {
  enhancedAnalyze,
  parseAiEnrichmentPayload: parseAiValidatorPayload,
  parseAiValidatorPayload,
  buildEnrichmentPrompt,
  buildPerformanceContext
};
