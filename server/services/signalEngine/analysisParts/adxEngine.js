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

function computeDirectionalMovement(prev, curr) {
  const upMove = toNumber(curr.high) - toNumber(prev.high);
  const downMove = toNumber(prev.low) - toNumber(curr.low);
  const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
  const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;
  return { plusDM, minusDM };
}

function computeTrueRange(prev, curr) {
  const high = toNumber(curr.high);
  const low = toNumber(curr.low);
  const prevClose = toNumber(prev.close);
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose)
  );
}

function calculateADX(klines, period = 14) {
  if (!Array.isArray(klines) || klines.length < period + 2) {
    return {
      adx: 15,
      plusDI: 0,
      minusDI: 0
    };
  }

  const trList = [];
  const plusDMList = [];
  const minusDMList = [];

  for (let i = 1; i < klines.length; i += 1) {
    const prev = klines[i - 1];
    const curr = klines[i];
    trList.push(computeTrueRange(prev, curr));
    const dm = computeDirectionalMovement(prev, curr);
    plusDMList.push(dm.plusDM);
    minusDMList.push(dm.minusDM);
  }

  let tr14 = trList.slice(0, period).reduce((sum, value) => sum + value, 0);
  let plusDM14 = plusDMList.slice(0, period).reduce((sum, value) => sum + value, 0);
  let minusDM14 = minusDMList.slice(0, period).reduce((sum, value) => sum + value, 0);

  const dxValues = [];

  for (let i = period; i < trList.length; i += 1) {
    tr14 = tr14 - (tr14 / period) + trList[i];
    plusDM14 = plusDM14 - (plusDM14 / period) + plusDMList[i];
    minusDM14 = minusDM14 - (minusDM14 / period) + minusDMList[i];

    const plusDI = tr14 > 0 ? (plusDM14 / tr14) * 100 : 0;
    const minusDI = tr14 > 0 ? (minusDM14 / tr14) * 100 : 0;
    const denom = plusDI + minusDI;
    const dx = denom > 0 ? (Math.abs(plusDI - minusDI) / denom) * 100 : 0;
    dxValues.push(dx);
  }

  if (dxValues.length === 0) {
    return {
      adx: 15,
      plusDI: 0,
      minusDI: 0
    };
  }

  const start = Math.max(0, dxValues.length - period);
  let adx = dxValues.slice(start).reduce((sum, value) => sum + value, 0) / Math.min(period, dxValues.length);

  for (let i = start + 1; i < dxValues.length; i += 1) {
    adx = ((adx * (period - 1)) + dxValues[i]) / period;
  }

  const lastPlusDI = tr14 > 0 ? (plusDM14 / tr14) * 100 : 0;
  const lastMinusDI = tr14 > 0 ? (minusDM14 / tr14) * 100 : 0;

  return {
    adx: round(adx, 3),
    plusDI: round(lastPlusDI, 3),
    minusDI: round(lastMinusDI, 3)
  };
}

function classifyAdxStrength(adx) {
  if (adx >= 40) return 'VERY_STRONG';
  if (adx >= 30) return 'STRONG';
  if (adx >= 22) return 'MODERATE';
  if (adx >= 16) return 'WEAK';
  return 'VERY_WEAK';
}

function evaluateAdxForSignal(trend, adxData, trigger) {
  const adx = toNumber(adxData?.adx);
  const plusDI = toNumber(adxData?.plusDI);
  const minusDI = toNumber(adxData?.minusDI);
  const strength = classifyAdxStrength(adx);
  const isSideways = adx < 18;

  let adjustment = 0;
  const flags = [];

  const directionalAligned = (trend === 'BUY' && plusDI >= minusDI) || (trend === 'SELL' && minusDI >= plusDI);

  if (strength === 'VERY_WEAK') {
    adjustment -= 10;
    flags.push('ADX_VERY_WEAK');
  } else if (strength === 'WEAK') {
    adjustment -= 6;
    flags.push('ADX_WEAK');
  } else if (strength === 'STRONG') {
    adjustment += directionalAligned ? 6 : 1;
    flags.push('ADX_STRONG');
  } else if (strength === 'VERY_STRONG') {
    adjustment += directionalAligned ? 8 : 2;
    flags.push('ADX_VERY_STRONG');
  } else if (strength === 'MODERATE' && directionalAligned) {
    adjustment += 3;
  }

  const breakoutTrigger = trigger === 'VOLATILITY_BREAKOUT' || trigger === 'CROSSOVER';
  if (isSideways && breakoutTrigger) {
    adjustment -= 7;
    flags.push('SIDEWAYS_BREAKOUT_SUPPRESSION');
  }

  if (!directionalAligned) {
    adjustment -= 3;
    flags.push('ADX_DI_MISALIGNMENT');
  }

  return {
    adx,
    plusDI,
    minusDI,
    strength,
    isSideways,
    directionalAligned,
    adjustment: clamp(adjustment, -18, 12),
    flags
  };
}

module.exports = {
  calculateADX,
  classifyAdxStrength,
  evaluateAdxForSignal
};
