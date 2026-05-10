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

function evaluateCvdForSignal(trend, realtimeContext, momentum = 0) {
  if (!realtimeContext) {
    return {
      adjustment: 0,
      flags: ['CVD_UNAVAILABLE'],
      aligned: false,
      divergence: false
    };
  }

  const cvd1m = toNumber(realtimeContext.cvd1m);
  const cvd5m = toNumber(realtimeContext.cvd5m);
  const cvd15m = toNumber(realtimeContext.cvd15m);
  const cvdSlope15m = toNumber(realtimeContext.cvdSlope15m);
  const cvdDivergence = String(realtimeContext.cvdDivergence || 'NONE').toUpperCase();
  const imbalance = toNumber(realtimeContext.tradeImbalance1m);
  const sparse = realtimeContext.stale === true || toNumber(realtimeContext.tradeCount1m) < 8;

  if (sparse) {
    return {
      adjustment: -2,
      flags: ['CVD_SPARSE_FLOW'],
      aligned: false,
      divergence: false
    };
  }

  let adjustment = 0;
  const flags = [];

  const cumulativeAligned = trend === 'BUY'
    ? (cvd5m > 0 && cvd15m >= 0 && cvdSlope15m >= 0)
    : (cvd5m < 0 && cvd15m <= 0 && cvdSlope15m <= 0);

  if (cumulativeAligned) {
    adjustment += 7;
    flags.push('CVD_ALIGNED');
  } else {
    adjustment -= 6;
    flags.push('CVD_MISALIGNED');
  }

  if ((trend === 'BUY' && cvd1m > 0 && imbalance > 0.12) || (trend === 'SELL' && cvd1m < 0 && imbalance < -0.12)) {
    adjustment += 3;
    flags.push('CVD_BREAKOUT_FLOW_CONFIRM');
  }

  const bullishDivergence = cvdDivergence === 'BULLISH';
  const bearishDivergence = cvdDivergence === 'BEARISH';

  if (trend === 'BUY' && bearishDivergence) {
    adjustment -= 9;
    flags.push('CVD_BEARISH_DIVERGENCE');
  }
  if (trend === 'SELL' && bullishDivergence) {
    adjustment -= 9;
    flags.push('CVD_BULLISH_DIVERGENCE');
  }

  if (trend === 'BUY' && bullishDivergence && momentum < 0) {
    adjustment += 2;
    flags.push('CVD_REVERSAL_SUPPORT');
  }
  if (trend === 'SELL' && bearishDivergence && momentum > 0) {
    adjustment += 2;
    flags.push('CVD_REVERSAL_SUPPORT');
  }

  return {
    adjustment: clamp(adjustment, -16, 12),
    flags,
    aligned: cumulativeAligned,
    divergence: bullishDivergence || bearishDivergence,
    metrics: {
      cvd1m: round(cvd1m, 2),
      cvd5m: round(cvd5m, 2),
      cvd15m: round(cvd15m, 2),
      cvdSlope15m: round(cvdSlope15m, 4),
      divergence: cvdDivergence
    }
  };
}

module.exports = {
  evaluateCvdForSignal
};
