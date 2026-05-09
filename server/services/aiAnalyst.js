const { analyzePerformance } = require('./aiLearning');
const { askGroqWithMeta } = require('./groqService');
const { askNvidiaWithMeta } = require('./nvidiaService');
const { settings } = require('./signalEngine/config');

const {
  SIGNAL_AI_MODE,
  SIGNAL_AI_ENRICHMENT_TIMING,
  SIGNAL_AI_RETRY_COUNT,
  SIGNAL_AI_RETRY_BACKOFF_MS,
  SIGNAL_AI_TIMEOUT_MS,
  SIGNAL_AI_TRIGGER_MIN_CONFIDENCE
} = settings;

/**
 * AI Analyst Layer for signal evaluation and decision making.
 * Returns enriched signal with aiScore, aiDecision, and aiMessage.
 */
function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
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

function deriveDecision(score, forceReject = false) {
  if (forceReject) return 'REJECT';
  if (score >= 75) return 'STRONG_APPROVE';
  if (score >= 60) return 'APPROVE';
  if (score >= 50) return 'WEAK_APPROVE';
  return 'REJECT';
}

function formatNumber(value, decimals = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'N/A';
  return parsed.toFixed(decimals);
}

function formatValue(value) {
  if (value == null || value === '') return 'N/A';
  return String(value);
}

function buildRiskContext(signal, macroSummary, orderBookSummary) {
  const reason = signal.reason || {};
  const breakdown = signal.confidenceBreakdown || {};

  return `Coin: ${formatValue(signal.coin)}
Type: ${formatValue(signal.type)}
Entry: ${formatValue(signal.entryPrice)}, Target: ${formatValue(signal.target)}, StopLoss: ${formatValue(signal.stopLoss)}
MachineConfidence: ${formatValue(signal.confidence)}%
SignalQuality: ${formatValue(signal.signalQuality || signal.trendStrength)}
AIHeuristicScore: ${formatValue(signal.aiScore)}/100
AIDecision: ${formatValue(signal.aiDecision)}
Trigger: ${formatValue(signal.trigger)}
Regime: ${formatValue(signal.regime)}
HigherTimeframeTrend: ${formatValue(signal.higherTimeframeTrend)}
RSI: ${formatNumber(signal.rsi)}, PrevRSI: ${formatNumber(signal.prevRsi)}
SentimentScore: ${formatNumber(signal.sentimentScore, 3)}
VolumeSpike: ${signal.volumeSpike ? 'YES' : 'NO'}
BTCTrend: ${formatValue(signal.btcTrend)}
LateEntry: ${signal.isLateEntry ? 'YES' : 'NO'}
ReasonTrend: ${formatValue(reason.trend)}
ReasonMomentum: ${formatValue(reason.momentum)}
ReasonVolume: ${formatValue(reason.volume)}
ReasonRSI: ${formatValue(reason.rsi)}
ReasonMACD: ${formatValue(reason.macd)}
ReasonExecution: ${formatValue(reason.execution)}
ReasonSlippageRisk: ${formatValue(reason.slippageRisk)}
VolumeConfirmed: ${formatValue(reason.volumeConfirmed)}
DeltaRatio: ${formatValue(reason.deltaRatio)}
NewsSummary: ${formatValue(signal.newsSummary || reason.sentiment)}
ConfidenceBreakdownTechnical: ${formatValue(breakdown.technical)}
ConfidenceBreakdownMarket: ${formatValue(breakdown.market)}
ConfidenceBreakdownSentiment: ${formatValue(breakdown.sentiment)}
ConfidenceBreakdownBonus: ${formatValue(breakdown.bonus)}
ConfidenceBreakdownPenalty: ${formatValue(breakdown.penalty)}
MacroSummary: ${macroSummary}
OrderBookSummary: ${orderBookSummary}
FundingRate: ${formatNumber(signal.futuresData?.fundingRate, 6)}
LongShortRatio: ${formatNumber(signal.futuresData?.longShortRatio, 3)}
TakerBuySellRatio: ${formatNumber(signal.futuresData?.takerBuySellRatio, 3)}
OpenInterest: ${formatNumber(signal.futuresData?.openInterest, 0)}
TakerBuyVolume: ${formatNumber(signal.takerBuyVolume, 2)}
NumberOfTrades: ${formatValue(signal.numberOfTrades)}
AIHeuristicNotes: ${formatValue(signal.aiMessage)}`;
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
  // Guard against missing signal
  if (!signal) return null;

  let score = 50;
  const message = [];

  // TREND QUALITY
  if (signal.trendStrength === 'STRONG') {
    score += 15;
    message.push('Strong trend');
  } else if (signal.trendStrength === 'WEAK') {
    score -= 10;
    message.push('Weak trend');
  }

  // ENTRY TIMING
  if (signal.isLateEntry) {
    score -= 20;
    message.push('Late entry risk');
  }

  // VOLUME CONFIRMATION
  if (signal.volumeSpike) {
    score += 10;
    message.push('Volume supports move');
  }

  // BTC CONFLICT
  if (signal.btcTrend === 'STRONG_BEARISH' && signal.type === 'BUY') {
    score -= 15;
    message.push('BTC against trade');
  }

  // RSI-based scoring
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

  // Confidence-based scoring
  if (signal.confidence >= 80) {
    score += 8;
    message.push('High confidence signal');
  } else if (signal.confidence < 65) {
    score -= 5;
    message.push('Low confidence');
  }

  // Trigger quality bonus
  if (signal.trigger === 'VOLATILITY_BREAKOUT') {
    score += 5;
    message.push('Breakout trigger');
  } else if (signal.trigger === 'CROSSOVER') {
    score += 5;
    message.push('EMA crossover');
  }

  // Macro trend integration (DXY + S&P500)
  const macroAdjustments = applyMacroAdjustments(signal);
  score += macroAdjustments.delta;
  message.push(...macroAdjustments.notes);

  // Order book liquidity integration (whale wall + bid/ask ratio)
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

function buildEnrichmentPrompt(analyzed, fullRiskContext, performanceContext) {
  return `You are a crypto trading signal evaluator.
Return ONLY valid JSON with this exact shape:
{"confidence_percent": <integer 0-100>, "risk_note": "<max 40 words>"}

Rules:
- confidence_percent must be an integer between 0 and 100.
- risk_note must be concise and practical.
- No markdown. No extra keys. No explanation outside JSON.

Recent Strategy Performance:
${performanceContext}

Full Signal Context:
${fullRiskContext}`;
}

function parseAiEnrichmentPayload(rawText) {
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

  const confidence = parseAiConfidenceScore(parsed.confidence_percent);
  const riskNote = typeof parsed.risk_note === 'string' ? parsed.risk_note.trim() : '';

  return {
    confidence,
    riskNote
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
  analyzed.aiDecision = deriveDecision(analyzed.aiScore, analyzed.blockedByLiquidity === true);
  analyzed.aiStatus = 'SKIPPED';
  analyzed.aiAttempts = 0;
  analyzed.aiError = null;
  analyzed.nvidiaConfidence = null;
  analyzed.nvidiaInsight = '';
  analyzed.nvidiaStatus = 'SKIPPED';
  analyzed.nvidiaAttempts = 0;
  analyzed.nvidiaError = null;

  const machineConfidence = Number(analyzed.confidence);
  if (!Number.isFinite(machineConfidence) || machineConfidence < SIGNAL_AI_TRIGGER_MIN_CONFIDENCE) {
    analyzed.aiConfidence = Number.isFinite(machineConfidence) ? machineConfidence : (analyzed.aiScore ?? null);
    analyzed.groqInsight = '';
    analyzed.aiStatus = 'SKIPPED';
    analyzed.aiError = 'below_ai_trigger_confidence';
    analyzed.nvidiaStatus = 'SKIPPED';
    analyzed.nvidiaError = 'below_ai_trigger_confidence';
    return analyzed;
  }

  const macroSummary = analyzed.macroTrends
    ? `DXY:${analyzed.macroTrends.dxy?.trend ?? 'N/A'} (${Number(analyzed.macroTrends.dxy?.changePct || 0).toFixed(2)}%), SP500:${analyzed.macroTrends.sp500?.trend ?? 'N/A'} (${Number(analyzed.macroTrends.sp500?.changePct || 0).toFixed(2)}%)`
    : 'N/A';

  const orderBookSummary = analyzed.orderBookLiquidity
    ? `Bid/Ask Ratio:${Number(analyzed.orderBookLiquidity.bidAskVolumeRatio || 0).toFixed(2)}, AskWall:${analyzed.orderBookLiquidity.massiveAskWallDetected ? 'YES' : 'NO'}, Blocked:${analyzed.orderBookLiquidity.blockedByLiquidity ? 'YES' : 'NO'}`
    : 'N/A';

  const fullRiskContext = buildRiskContext(analyzed, macroSummary, orderBookSummary);
  const performanceContext = buildPerformanceContext(perf, analyzed);
  const enrichmentPrompt = buildEnrichmentPrompt(analyzed, fullRiskContext, performanceContext);

  const shouldRunSyncEnrichment = SIGNAL_AI_ENRICHMENT_TIMING === 'SYNC';
  if (!shouldRunSyncEnrichment) {
    analyzed.aiConfidence = analyzed.confidence ?? analyzed.aiScore ?? null;
    analyzed.groqInsight = '';
    analyzed.aiStatus = 'SKIPPED';
    analyzed.aiError = 'sync_enrichment_disabled';
    analyzed.nvidiaStatus = 'SKIPPED';
    analyzed.nvidiaError = 'sync_enrichment_disabled';
    return analyzed;
  }

  const fallbackConfidence = analyzed.confidence ?? analyzed.aiScore ?? null;
  const fallbackInsight = 'AI enrichment fallback: machine signal kept as source of truth.';
  const nvidiaFallbackInsight = 'NVIDIA enrichment fallback: provider response unavailable.';
  const aiRequest = await askGroqWithMetaFn(enrichmentPrompt, null, {
    retryCount: SIGNAL_AI_RETRY_COUNT,
    retryBackoffMs: SIGNAL_AI_RETRY_BACKOFF_MS,
    timeoutMs: SIGNAL_AI_TIMEOUT_MS
  });

  analyzed.aiAttempts = aiRequest.attempts || 0;

  const parsedEnrichment = parseAiEnrichmentPayload(aiRequest.text);
  if (parsedEnrichment?.confidence != null) {
    analyzed.aiConfidence = parsedEnrichment.confidence;
    analyzed.groqInsight = parsedEnrichment.riskNote || fallbackInsight;
    analyzed.aiStatus = 'SUCCESS';
    analyzed.aiError = null;
  } else {
    analyzed.aiConfidence = fallbackConfidence;
    analyzed.groqInsight = fallbackInsight;
    analyzed.aiStatus = 'FALLBACK';
    analyzed.aiError = aiRequest.error || 'invalid_ai_response_payload';
  }

  const nvidiaRequest = await askNvidiaWithMetaFn(enrichmentPrompt, null, {
    retryCount: SIGNAL_AI_RETRY_COUNT,
    retryBackoffMs: SIGNAL_AI_RETRY_BACKOFF_MS,
    timeoutMs: SIGNAL_AI_TIMEOUT_MS
  });

  analyzed.nvidiaAttempts = nvidiaRequest.attempts || 0;
  const parsedNvidiaEnrichment = parseAiEnrichmentPayload(nvidiaRequest.text);
  if (parsedNvidiaEnrichment?.confidence != null) {
    analyzed.nvidiaConfidence = parsedNvidiaEnrichment.confidence;
    analyzed.nvidiaInsight = parsedNvidiaEnrichment.riskNote || nvidiaFallbackInsight;
    analyzed.nvidiaStatus = 'SUCCESS';
    analyzed.nvidiaError = null;
  } else {
    analyzed.nvidiaConfidence = null;
    analyzed.nvidiaInsight = nvidiaFallbackInsight;
    analyzed.nvidiaStatus = 'FALLBACK';
    analyzed.nvidiaError = nvidiaRequest.error || 'invalid_ai_response_payload';
  }

  if (SIGNAL_AI_MODE !== 'ADVISORY') {
    analyzed.aiMessage = `${analyzed.aiMessage || ''} | AI mode:${SIGNAL_AI_MODE} not fully enabled; running advisory behavior.`.trim();
  }

  return analyzed;
}

module.exports = {
  enhancedAnalyze,
  parseAiEnrichmentPayload,
  buildEnrichmentPrompt,
  buildPerformanceContext
};
