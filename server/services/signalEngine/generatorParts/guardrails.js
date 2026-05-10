function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyGuardrailPenalties(context = {}) {
  const {
    trend,
    btcTrend,
    higherTimeframeTrend,
    orderBookLiquidity,
    executionQualityData,
    macroTrends
  } = context;

  let penalty = 0;
  const flags = [];
  let conflictCount = 0;

  const bidQuoteVolume = Number(orderBookLiquidity?.bidQuoteVolume || 0);
  const askQuoteVolume = Number(orderBookLiquidity?.askQuoteVolume || 0);
  const ratio = Number(orderBookLiquidity?.bidAskVolumeRatio);
  if ((bidQuoteVolume > 0 || askQuoteVolume > 0) && Math.min(bidQuoteVolume, askQuoteVolume) < 25_000) {
    penalty -= 4;
    flags.push('THIN_DEPTH');
  }
  if (Number.isFinite(ratio) && (ratio < 0.6 || ratio > 1.7)) {
    penalty -= 3;
    flags.push('UNSTABLE_ORDERBOOK_RATIO');
  }
  if (Array.isArray(orderBookLiquidity?.flags)) {
    if (orderBookLiquidity.flags.includes('DISAPPEARING_LIQUIDITY')) {
      penalty -= 4;
      flags.push('DISAPPEARING_LIQUIDITY');
    }
    if (orderBookLiquidity.flags.includes('DEPTH_SPOOF_RISK')) {
      penalty -= 4;
      flags.push('DEPTH_SPOOF_RISK');
    }
  }

  const spreadPct = Number(executionQualityData?.spreadPct);
  const slippageRisk = String(executionQualityData?.slippageRisk || '').toUpperCase();
  if (Number.isFinite(spreadPct) && spreadPct > 0.18) {
    penalty -= 3;
    flags.push('WIDE_SPREAD');
  }
  if (slippageRisk === 'HIGH') {
    penalty -= 4;
    flags.push('HIGH_SLIPPAGE_RISK');
  }

  const btcKey = String(btcTrend || 'UNKNOWN').toUpperCase();
  if (trend === 'BUY' && (btcKey.includes('BEARISH') || btcKey === 'UNKNOWN')) conflictCount += 1;
  if (trend === 'SELL' && btcKey.includes('BULLISH')) conflictCount += 1;

  const htTrend = String(higherTimeframeTrend?.trend || higherTimeframeTrend || '').toLowerCase();
  if (trend === 'BUY' && htTrend === 'bearish') conflictCount += 1;
  if (trend === 'SELL' && htTrend === 'bullish') conflictCount += 1;

  const dxyDirection = String(macroTrends?.dxy?.direction || '').toUpperCase();
  const spDirection = String(macroTrends?.sp500?.direction || '').toUpperCase();
  if (trend === 'BUY' && dxyDirection === 'UP') conflictCount += 1;
  if (trend === 'BUY' && spDirection === 'DOWN') conflictCount += 1;
  if (trend === 'SELL' && dxyDirection === 'DOWN') conflictCount += 1;
  if (trend === 'SELL' && spDirection === 'UP') conflictCount += 1;

  if (conflictCount >= 3) {
    penalty -= 6;
    flags.push('REGIME_CONFLICT_CLUSTER');
  } else if (conflictCount === 2) {
    penalty -= 3;
    flags.push('REGIME_CONFLICT_DOUBLE');
  }

  return {
    penalty: clamp(penalty, -15, 0),
    flags,
    conflictCount
  };
}

module.exports = {
  applyGuardrailPenalties
};
