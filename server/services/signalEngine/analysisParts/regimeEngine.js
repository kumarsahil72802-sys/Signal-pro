function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(digits));
}

function buildRegimePolicy(regime) {
  switch (regime) {
    case 'TRENDING':
      return {
        confidenceFloor: 54,
        breakoutConfirmationNeed: 'MEDIUM',
        riskMode: 'TREND_FOLLOW',
        rrMultiplier: 1.2
      };
    case 'BREAKOUT':
      return {
        confidenceFloor: 58,
        breakoutConfirmationNeed: 'HIGH',
        riskMode: 'BREAKOUT',
        rrMultiplier: 1.25
      };
    case 'HIGH_VOLATILITY':
      return {
        confidenceFloor: 60,
        breakoutConfirmationNeed: 'HIGH',
        riskMode: 'WIDE_STOP',
        rrMultiplier: 1.1
      };
    case 'LOW_VOLATILITY':
      return {
        confidenceFloor: 56,
        breakoutConfirmationNeed: 'HIGH',
        riskMode: 'MEAN_REVERSION',
        rrMultiplier: 0.95
      };
    case 'CHOPPY':
      return {
        confidenceFloor: 62,
        breakoutConfirmationNeed: 'VERY_HIGH',
        riskMode: 'DEFENSIVE',
        rrMultiplier: 0.85
      };
    case 'RANGING':
    default:
      return {
        confidenceFloor: 60,
        breakoutConfirmationNeed: 'HIGH',
        riskMode: 'RANGE',
        rrMultiplier: 0.9
      };
  }
}

function detectMarketRegimeAdvanced(context = {}) {
  const adx = toNumber(context.adxData?.adx);
  const bbWidthPct = toNumber(context.bbWidthPercent);
  const atrPct = toNumber(context.atrPct);
  const slopeAbs = Math.abs(toNumber(context.slope));
  const structureBias = String(context.structureData?.trendBias || 'NEUTRAL').toUpperCase();
  const breakoutTrigger = Boolean(context.breakoutSignal);
  const bbExpanding = Boolean(context.bbExpanding);

  let regime = 'RANGING';

  if (breakoutTrigger && adx >= 20 && bbExpanding) {
    regime = 'BREAKOUT';
  } else if (adx >= 25 && slopeAbs >= 0.08 && (structureBias.startsWith('BULLISH') || structureBias.startsWith('BEARISH'))) {
    regime = 'TRENDING';
  } else if (atrPct >= 2.2 || bbWidthPct >= 4.2) {
    regime = 'HIGH_VOLATILITY';
  } else if (adx < 17 && bbWidthPct <= 1.4 && atrPct <= 0.85) {
    regime = 'LOW_VOLATILITY';
  } else if (adx < 20 && bbWidthPct > 2.5 && slopeAbs < 0.07) {
    regime = 'CHOPPY';
  } else if (adx < 22 && slopeAbs < 0.08) {
    regime = 'RANGING';
  }

  const policy = buildRegimePolicy(regime);

  let adjustment = 0;
  const flags = [];
  if (regime === 'TRENDING') adjustment += 5;
  if (regime === 'BREAKOUT') adjustment += 4;
  if (regime === 'RANGING') adjustment -= 5;
  if (regime === 'CHOPPY') adjustment -= 8;
  if (regime === 'HIGH_VOLATILITY') adjustment -= 4;
  if (regime === 'LOW_VOLATILITY') adjustment -= 4;

  if (regime === 'BREAKOUT' && !bbExpanding) {
    adjustment -= 5;
    flags.push('BREAKOUT_WITHOUT_EXPANSION');
  }

  return {
    regime,
    regimeScore: round(clamp(50 + adjustment * 4, 10, 95), 2),
    adjustment: clamp(adjustment, -12, 8),
    policy,
    flags,
    diagnostics: {
      adx: round(adx, 3),
      bbWidthPct: round(bbWidthPct, 3),
      atrPct: round(atrPct, 3),
      slopeAbs: round(slopeAbs, 4)
    }
  };
}

module.exports = {
  detectMarketRegimeAdvanced,
  buildRegimePolicy
};
