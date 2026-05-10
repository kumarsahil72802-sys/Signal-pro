const { computePivotPoints } = require('./supportResistance');

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

function classifySwingSequence(swings = [], direction = 'high') {
  if (!Array.isArray(swings) || swings.length < 3) {
    return {
      sequence: 'INSUFFICIENT',
      continuation: false
    };
  }

  const recent = swings.slice(-3);
  const [a, b, c] = recent.map((item) => toNumber(item.price));

  if (direction === 'high') {
    if (a < b && b < c) return { sequence: 'HH', continuation: true };
    if (a > b && b > c) return { sequence: 'LH', continuation: true };
  } else {
    if (a < b && b < c) return { sequence: 'HL', continuation: true };
    if (a > b && b > c) return { sequence: 'LL', continuation: true };
  }

  return {
    sequence: 'MIXED',
    continuation: false
  };
}

function detectStructureBreak(closes, latestLowPivot, latestHighPivot) {
  const latestClose = toNumber(closes[closes.length - 1]);
  if (!Number.isFinite(latestClose) || latestClose <= 0) {
    return {
      bullishBreak: false,
      bearishBreak: false
    };
  }

  const bullishBreak = Number.isFinite(toNumber(latestHighPivot?.price, NaN)) && latestClose > toNumber(latestHighPivot.price);
  const bearishBreak = Number.isFinite(toNumber(latestLowPivot?.price, NaN)) && latestClose < toNumber(latestLowPivot.price);

  return { bullishBreak, bearishBreak };
}

function analyzeMarketStructure(klines = []) {
  if (!Array.isArray(klines) || klines.length < 30) {
    return {
      trendBias: 'NEUTRAL',
      confidence: 0,
      structureBreak: null,
      reversalRisk: 'UNKNOWN',
      swings: { highs: [], lows: [] },
      summary: {}
    };
  }

  const closes = klines.map((candle) => toNumber(candle.close));
  const pivots = computePivotPoints(klines, 2);
  const highs = pivots.highs.sort((a, b) => a.index - b.index);
  const lows = pivots.lows.sort((a, b) => a.index - b.index);

  const highSeq = classifySwingSequence(highs, 'high');
  const lowSeq = classifySwingSequence(lows, 'low');

  let trendBias = 'NEUTRAL';
  let structureConfidence = 0;

  const bullishStructure = highSeq.sequence === 'HH' && lowSeq.sequence === 'HL';
  const bearishStructure = highSeq.sequence === 'LH' && lowSeq.sequence === 'LL';

  if (bullishStructure) {
    trendBias = 'BULLISH';
    structureConfidence = 78;
  } else if (bearishStructure) {
    trendBias = 'BEARISH';
    structureConfidence = 78;
  } else if (highSeq.sequence === 'HH' || lowSeq.sequence === 'HL') {
    trendBias = 'BULLISH_WEAK';
    structureConfidence = 58;
  } else if (highSeq.sequence === 'LH' || lowSeq.sequence === 'LL') {
    trendBias = 'BEARISH_WEAK';
    structureConfidence = 58;
  }

  const structureBreak = detectStructureBreak(closes, lows[lows.length - 1], highs[highs.length - 1]);
  const reversalRisk = (
    (trendBias.startsWith('BULLISH') && structureBreak.bearishBreak)
    || (trendBias.startsWith('BEARISH') && structureBreak.bullishBreak)
  ) ? 'HIGH' : 'LOW';

  return {
    trendBias,
    confidence: structureConfidence,
    structureBreak,
    reversalRisk,
    swings: {
      highs: highs.slice(-6).map((item) => ({ index: item.index, price: round(item.price, 6) })),
      lows: lows.slice(-6).map((item) => ({ index: item.index, price: round(item.price, 6) }))
    },
    summary: {
      highSequence: highSeq.sequence,
      lowSequence: lowSeq.sequence
    }
  };
}

function evaluateStructureForSignal(trend, structureData) {
  const bias = String(structureData?.trendBias || 'NEUTRAL').toUpperCase();
  const breakData = structureData?.structureBreak || {};

  let adjustment = 0;
  const flags = [];

  const aligned = (trend === 'BUY' && (bias === 'BULLISH' || bias === 'BULLISH_WEAK'))
    || (trend === 'SELL' && (bias === 'BEARISH' || bias === 'BEARISH_WEAK'));

  if (aligned) {
    adjustment += bias.endsWith('WEAK') ? 3 : 8;
    flags.push('STRUCTURE_ALIGNED');
  } else if (bias === 'NEUTRAL') {
    adjustment -= 4;
    flags.push('STRUCTURE_NEUTRAL');
  } else {
    adjustment -= 12;
    flags.push('STRUCTURE_MISALIGNED');
  }

  const bullishBreak = Boolean(breakData.bullishBreak);
  const bearishBreak = Boolean(breakData.bearishBreak);
  if (trend === 'BUY' && bearishBreak) {
    adjustment -= 10;
    flags.push('STRUCTURE_BREAK_AGAINST_BUY');
  }
  if (trend === 'SELL' && bullishBreak) {
    adjustment -= 10;
    flags.push('STRUCTURE_BREAK_AGAINST_SELL');
  }
  if (trend === 'BUY' && bullishBreak) {
    adjustment += 4;
    flags.push('BULLISH_BREAK_CONFIRMATION');
  }
  if (trend === 'SELL' && bearishBreak) {
    adjustment += 4;
    flags.push('BEARISH_BREAK_CONFIRMATION');
  }

  return {
    aligned,
    adjustment: clamp(adjustment, -22, 14),
    flags
  };
}

module.exports = {
  analyzeMarketStructure,
  evaluateStructureForSignal
};
