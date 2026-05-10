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

function candleStats(candle = {}) {
  const open = toNumber(candle.open);
  const close = toNumber(candle.close);
  const high = toNumber(candle.high);
  const low = toNumber(candle.low);
  const range = Math.max(0, high - low);
  const body = Math.abs(close - open);
  const bodyPctOfRange = range > 0 ? body / range : 0;
  const direction = close >= open ? 'UP' : 'DOWN';
  const upperWick = Math.max(0, high - Math.max(open, close));
  const lowerWick = Math.max(0, Math.min(open, close) - low);

  return {
    open,
    close,
    high,
    low,
    range,
    body,
    bodyPctOfRange,
    direction,
    upperWick,
    lowerWick
  };
}

function detectLiquidationPressure(context = {}) {
  const {
    trend,
    klines = [],
    atr = 0,
    volumeData = {},
    futuresData = {},
    realtimeContext = {}
  } = context;

  const last = klines[klines.length - 1] || {};
  const prev = klines[klines.length - 2] || {};
  const lastStats = candleStats(last);
  const prevStats = candleStats(prev);

  const atrValue = toNumber(atr);
  const rangeToAtr = atrValue > 0 ? lastStats.range / atrValue : 0;
  const volumeRatio = toNumber(volumeData.ratio);
  const oiTrendPct = toNumber(futuresData?.openInterestTrendPct);
  const fundingRate = toNumber(futuresData?.fundingRate);
  const crowdingBias = toNumber(futuresData?.crowdingBias);
  const takerRatio = toNumber(futuresData?.takerBuySellRatio);
  const imbalance = toNumber(realtimeContext?.tradeImbalance1m);

  const abnormalExpansion = rangeToAtr >= 1.8;
  const abnormalVolume = volumeRatio >= 1.7;
  const abruptReversal = (
    (lastStats.direction === 'UP' && lastStats.upperWick > lastStats.body * 1.1)
    || (lastStats.direction === 'DOWN' && lastStats.lowerWick > lastStats.body * 1.1)
  ) && rangeToAtr >= 1.5;

  const possibleShortSqueeze = lastStats.direction === 'UP'
    && abnormalExpansion
    && abnormalVolume
    && (oiTrendPct <= 0.2 || crowdingBias <= 0.9 || fundingRate <= -0.00005)
    && (takerRatio >= 1.05 || imbalance >= 0.15);

  const possibleLongSqueeze = lastStats.direction === 'DOWN'
    && abnormalExpansion
    && abnormalVolume
    && (oiTrendPct <= 0.2 || crowdingBias >= 1.18 || fundingRate >= 0.00018)
    && (takerRatio <= 0.95 || imbalance <= -0.15);

  const liquidationCascade = (
    abnormalExpansion
    && abnormalVolume
    && oiTrendPct <= -1.2
    && lastStats.direction === prevStats.direction
    && prevStats.bodyPctOfRange >= 0.55
  );

  const exhaustionMove = abruptReversal && abnormalVolume;

  let adjustment = 0;
  const flags = [];

  if (trend === 'BUY' && possibleShortSqueeze) {
    adjustment += 4;
    flags.push('SHORT_SQUEEZE_SUPPORTIVE');
  }
  if (trend === 'SELL' && possibleLongSqueeze) {
    adjustment += 4;
    flags.push('LONG_SQUEEZE_SUPPORTIVE');
  }

  if (trend === 'BUY' && possibleLongSqueeze) {
    adjustment -= 10;
    flags.push('BUY_AGAINST_LONG_SQUEEZE');
  }
  if (trend === 'SELL' && possibleShortSqueeze) {
    adjustment -= 10;
    flags.push('SELL_AGAINST_SHORT_SQUEEZE');
  }

  if (liquidationCascade) {
    if ((trend === 'BUY' && lastStats.direction === 'DOWN') || (trend === 'SELL' && lastStats.direction === 'UP')) {
      adjustment -= 8;
      flags.push('CASCADE_AGAINST_TREND');
    } else {
      adjustment += 2;
      flags.push('CASCADE_WITH_TREND');
    }
  }

  if (exhaustionMove) {
    adjustment -= 6;
    flags.push('EXHAUSTION_MOVE');
  }

  return {
    adjustment: clamp(adjustment, -18, 10),
    flags,
    possibleShortSqueeze,
    possibleLongSqueeze,
    liquidationCascade,
    exhaustionMove,
    diagnostics: {
      rangeToAtr: round(rangeToAtr, 3),
      volumeRatio: round(volumeRatio, 3),
      oiTrendPct: round(oiTrendPct, 3),
      fundingRate: round(fundingRate, 7),
      crowdingBias: round(crowdingBias, 4)
    }
  };
}

module.exports = {
  detectLiquidationPressure
};
