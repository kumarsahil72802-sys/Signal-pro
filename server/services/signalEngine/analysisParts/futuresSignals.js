function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyFuturesAdjustment(trend, futuresData) {
  if (!trend || !futuresData) {
    return {
      adjustment: 0,
      notes: [],
      score: 0
    };
  }

  const fundingRate = normalize(futuresData.fundingRate);
  const oiTrendPct = normalize(futuresData.openInterestTrendPct);
  const takerRatio = normalize(futuresData.takerBuySellRatio);
  const globalLsRatio = normalize(futuresData.longShortRatio);
  const topPositionRatio = normalize(futuresData.topTraderPositionRatio);
  const topAccountRatio = normalize(futuresData.topTraderAccountRatio);

  let score = 0;
  const notes = [];

  const crowdLong = (value) => Number.isFinite(value) && value >= 1.35;
  const crowdShort = (value) => Number.isFinite(value) && value <= 0.75;
  const oiRising = Number.isFinite(oiTrendPct) && oiTrendPct >= 0.8;
  const oiFalling = Number.isFinite(oiTrendPct) && oiTrendPct <= -0.8;

  if (trend === 'BUY') {
    if (Number.isFinite(fundingRate)) {
      if (fundingRate <= -0.00005) {
        score += 1;
        notes.push('funding supportive for BUY');
      } else if (fundingRate >= 0.00025) {
        score -= 2;
        notes.push('funding crowded long');
      }
    }

    if (Number.isFinite(takerRatio)) {
      if (takerRatio >= 1.08) score += 1;
      if (takerRatio <= 0.92) score -= 1;
    }

    if (crowdLong(topPositionRatio) && crowdLong(topAccountRatio) && oiRising) {
      score -= 2;
      notes.push('top-trader long crowding');
    } else if (crowdShort(topPositionRatio) && oiRising) {
      score += 1;
      notes.push('short crowd squeeze potential');
    }

    if (Number.isFinite(globalLsRatio) && globalLsRatio <= 0.9 && oiRising) {
      score += 1;
      notes.push('public short bias');
    }
  }

  if (trend === 'SELL') {
    if (Number.isFinite(fundingRate)) {
      if (fundingRate >= 0.00018) {
        score += 1;
        notes.push('funding supportive for SELL');
      } else if (fundingRate <= -0.00018) {
        score -= 1;
        notes.push('funding crowded short');
      }
    }

    if (Number.isFinite(takerRatio)) {
      if (takerRatio <= 0.94) score += 1;
      if (takerRatio >= 1.08) score -= 1;
    }

    if (crowdShort(topPositionRatio) && crowdShort(topAccountRatio) && oiRising) {
      score -= 2;
      notes.push('top-trader short crowding');
    } else if (crowdLong(topPositionRatio) && oiRising) {
      score += 1;
      notes.push('long crowd unwind potential');
    }

    if (Number.isFinite(globalLsRatio) && globalLsRatio >= 1.15 && oiRising) {
      score += 1;
      notes.push('public long bias');
    }
  }

  if (oiFalling) {
    score -= 1;
    notes.push('open interest fading');
  }

  const boundedScore = clamp(score, -4, 4);
  return {
    adjustment: boundedScore * 2,
    notes,
    score: boundedScore
  };
}

function applyRealtimeAdjustment(trend, realtimeContext) {
  if (!trend || !realtimeContext) {
    return {
      adjustment: 0,
      notes: [],
      score: 0
    };
  }

  const imbalance = normalize(realtimeContext.tradeImbalance1m);
  const spreadPct = normalize(realtimeContext.spreadPct);
  const bookImbalancePct = normalize(realtimeContext.bookImbalancePct);
  const tradeCount = normalize(realtimeContext.tradeCount1m) || 0;
  const stale = realtimeContext.stale === true || realtimeContext.status === 'STALE';

  if (stale || tradeCount < 8) {
    return {
      adjustment: 0,
      notes: ['realtime data sparse'],
      score: 0
    };
  }

  let score = 0;
  const notes = [];

  if (trend === 'BUY') {
    if (Number.isFinite(imbalance)) {
      if (imbalance >= 0.15) score += 1;
      if (imbalance <= -0.15) score -= 1;
    }
    if (Number.isFinite(bookImbalancePct)) {
      if (bookImbalancePct >= 15) score += 1;
      if (bookImbalancePct <= -15) score -= 1;
    }
  }

  if (trend === 'SELL') {
    if (Number.isFinite(imbalance)) {
      if (imbalance <= -0.15) score += 1;
      if (imbalance >= 0.15) score -= 1;
    }
    if (Number.isFinite(bookImbalancePct)) {
      if (bookImbalancePct <= -15) score += 1;
      if (bookImbalancePct >= 15) score -= 1;
    }
  }

  if (Number.isFinite(spreadPct) && spreadPct > 0.12) {
    score -= 1;
    notes.push('realtime spread elevated');
  }

  const boundedScore = clamp(score, -2, 2);
  return {
    adjustment: boundedScore * 2,
    notes,
    score: boundedScore
  };
}

module.exports = {
  applyFuturesAdjustment,
  applyRealtimeAdjustment
};
