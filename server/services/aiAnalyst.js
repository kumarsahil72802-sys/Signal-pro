const { analyzePerformance } = require('./aiLearning');
const { askGroq } = require('./groqService');

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
ConfidenceBreakdownTechnical: ${formatValue(breakdown.technical)}
ConfidenceBreakdownMarket: ${formatValue(breakdown.market)}
ConfidenceBreakdownSentiment: ${formatValue(breakdown.sentiment)}
ConfidenceBreakdownBonus: ${formatValue(breakdown.bonus)}
ConfidenceBreakdownPenalty: ${formatValue(breakdown.penalty)}
MacroSummary: ${macroSummary}
OrderBookSummary: ${orderBookSummary}
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

async function enhancedAnalyze(signal) {
  const analyzed = analyzeSignal(signal);
  if (!analyzed) return null;

  const perf = await analyzePerformance();
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

  const macroSummary = analyzed.macroTrends
    ? `DXY:${analyzed.macroTrends.dxy?.trend ?? 'N/A'} (${Number(analyzed.macroTrends.dxy?.changePct || 0).toFixed(2)}%), SP500:${analyzed.macroTrends.sp500?.trend ?? 'N/A'} (${Number(analyzed.macroTrends.sp500?.changePct || 0).toFixed(2)}%)`
    : 'N/A';

  const orderBookSummary = analyzed.orderBookLiquidity
    ? `Bid/Ask Ratio:${Number(analyzed.orderBookLiquidity.bidAskVolumeRatio || 0).toFixed(2)}, AskWall:${analyzed.orderBookLiquidity.massiveAskWallDetected ? 'YES' : 'NO'}, Blocked:${analyzed.orderBookLiquidity.blockedByLiquidity ? 'YES' : 'NO'}`
    : 'N/A';

  const numericConfidencePrompt = `You are scoring trade quality probability.
Return ONLY one integer from 0 to 100.
No words. No symbols. No explanation.

Signal:
Coin: ${analyzed.coin}
Type: ${analyzed.type}
MachineConfidence: ${analyzed.confidence}
Trigger: ${analyzed.trigger}
RSI: ${analyzed.rsi ?? 'N/A'}
BTCTrend: ${analyzed.btcTrend ?? 'N/A'}
VolumeSpike: ${analyzed.volumeSpike ? 'YES' : 'NO'}
Macro: ${macroSummary}
OrderBook: ${orderBookSummary}
RuleAIHeuristicScore: ${analyzed.aiScore}`;

  try {
    const grokScoreRaw = await askGroq(numericConfidencePrompt, null);
    const parsedScore = parseAiConfidenceScore(grokScoreRaw);
    analyzed.aiConfidence = parsedScore ?? analyzed.aiScore ?? null;
  } catch (e) {
    analyzed.aiConfidence = analyzed.aiScore ?? null;
  }

  try {
    const fullRiskContext = buildRiskContext(analyzed, macroSummary, orderBookSummary);
    const prompt = `You are a crypto trading risk analyst.
Using the full signal context, respond in exactly 2 short sentences:
Sentence 1: why this setup may work.
Sentence 2: biggest downside risk.
Keep it practical and under 50 words total.

Full Signal Context:
${fullRiskContext}`;
    analyzed.groqInsight = await askGroq(prompt, 'No AI insight available.');
  } catch (e) { analyzed.groqInsight = 'No AI insight available.'; }

  return analyzed;
}

module.exports = { enhancedAnalyze };
