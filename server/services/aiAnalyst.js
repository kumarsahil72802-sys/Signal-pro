const { analyzePerformance } = require('./aiLearning');

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

  const trigger = analyzed.trigger;
  const triggerPerf = perf.triggerStats[trigger];

  if (triggerPerf) {
    const triggerWinRate = Math.round((triggerPerf.win / (triggerPerf.win + triggerPerf.loss)) * 100);

    if (triggerWinRate < 40) {
      analyzed.aiScore = Math.max(0, analyzed.aiScore - 10);
      analyzed.aiMessage += ' | Low win trigger';
      if (analyzed.aiScore < 50) {
        analyzed.aiDecision = 'REJECT';
      }
    } else if (triggerWinRate > 65) {
      analyzed.aiScore = Math.min(100, analyzed.aiScore + 10);
      analyzed.aiMessage += ' | High win trigger';
    }
  }

  return analyzed;
}

module.exports = { analyzeSignal, enhancedAnalyze };
