const { analyzePerformance } = require('./aiLearning');
const { askGroq } = require('./groqService');

/**
 * AI Analyst Layer for signal evaluation and decision making.
 * Returns enriched signal with aiScore, aiDecision, and aiMessage.
 */
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

  // FINAL DECISION based on score
  let decision = 'REJECT';
  if (score >= 75) decision = 'STRONG_APPROVE';
  else if (score >= 60) decision = 'APPROVE';
  else if (score >= 50) decision = 'WEAK_APPROVE';

  return {
    ...signal,
    aiScore: score,
    aiDecision: decision,
    aiMessage: message.join(' | ')
  };
}

async function enhancedAnalyze(signal) {
  const analyzed = analyzeSignal(signal);
  if (!analyzed) return null;

  const perf = await analyzePerformance();
  if (!perf) return analyzed;

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
      if (analyzed.aiScore < 50) {
        analyzed.aiDecision = 'REJECT';
      }
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
      if (analyzed.aiScore < 50) {
        analyzed.aiDecision = 'REJECT';
      }
    } else if (symbolTotal >= 6 && symbolWinRate > 68) {
      analyzed.aiScore = Math.min(100, analyzed.aiScore + 6);
      analyzed.aiMessage += ' | Coin-trigger edge';
    }
  }

  try {
    const prompt = `You are a crypto trading analyst. Evaluate this signal in 2 sentences max - is it a good setup and what is the main risk?
Coin: ${analyzed.coin}, Type: ${analyzed.type}, Confidence: ${analyzed.confidence}%, Trigger: ${analyzed.trigger}, RSI: ${analyzed.rsi ?? 'N/A'}, BTC Trend: ${analyzed.btcTrend ?? 'N/A'}, Volume Spike: ${analyzed.volumeSpike ? 'Yes' : 'No'}, AI Score: ${analyzed.aiScore}/100`;
    analyzed.groqInsight = await askGroq(prompt, 'No AI insight available.');
  } catch (e) { analyzed.groqInsight = 'No AI insight available.'; }

  return analyzed;
}

module.exports = { enhancedAnalyze };
