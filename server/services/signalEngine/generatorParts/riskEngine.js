function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolvePriceDecimals(price) {
  if (!Number.isFinite(price) || price <= 0) return 4;
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  if (price >= 1) return 4;
  if (price >= 0.1) return 5;
  if (price >= 0.01) return 6;
  if (price >= 0.001) return 7;
  return 8;
}

function round(value, decimals) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(decimals));
}

function regimeStopMultiplier(regime = '') {
  switch (String(regime).toUpperCase()) {
    case 'BREAKOUT':
      return 1.45;
    case 'HIGH_VOLATILITY':
      return 1.75;
    case 'LOW_VOLATILITY':
      return 1.05;
    case 'TRENDING':
      return 1.35;
    case 'CHOPPY':
      return 1.85;
    case 'RANGING':
    default:
      return 1.2;
  }
}

function regimeRr(regime = '') {
  switch (String(regime).toUpperCase()) {
    case 'TRENDING':
      return 2.0;
    case 'BREAKOUT':
      return 2.2;
    case 'HIGH_VOLATILITY':
      return 1.8;
    case 'LOW_VOLATILITY':
      return 1.5;
    case 'CHOPPY':
      return 1.25;
    case 'RANGING':
    default:
      return 1.4;
  }
}

function buildRiskManagedSignalData(coin, trend, entryPrice, atr, context = {}) {
  const decimals = resolvePriceDecimals(entryPrice);
  const minTick = Math.pow(10, -decimals);
  const safeAtr = toNumber(atr) > 0 ? toNumber(atr) : (entryPrice * 0.0075);

  const regime = String(context?.regimeContext?.regime || context?.legacyRegime || 'RANGING').toUpperCase();
  const baseStopMult = regimeStopMultiplier(regime);
  const baseRr = regimeRr(regime);

  const structureSupport = toNumber(context?.supportResistance?.signalImpact?.nearestSupport?.price, NaN);
  const structureResistance = toNumber(context?.supportResistance?.signalImpact?.nearestResistance?.price, NaN);

  let stopDistance = safeAtr * baseStopMult;
  let targetDistance = stopDistance * baseRr;

  if (trend === 'BUY' && Number.isFinite(structureSupport) && structureSupport > 0 && structureSupport < entryPrice) {
    const structuralStopDistance = Math.max(entryPrice - structureSupport, safeAtr * 0.95);
    stopDistance = Math.max(stopDistance, structuralStopDistance + (safeAtr * 0.25));
  }

  if (trend === 'SELL' && Number.isFinite(structureResistance) && structureResistance > entryPrice) {
    const structuralStopDistance = Math.max(structureResistance - entryPrice, safeAtr * 0.95);
    stopDistance = Math.max(stopDistance, structuralStopDistance + (safeAtr * 0.25));
  }

  if (context?.liquidationContext?.liquidationCascade) {
    stopDistance *= 1.12;
    targetDistance *= 0.92;
  }

  const confidence = toNumber(context.confidence, 60);
  const rrSkew = confidence >= 80 ? 1.08 : confidence <= 60 ? 0.92 : 1;
  targetDistance *= rrSkew;

  let target;
  let stopLoss;
  if (trend === 'BUY') {
    target = entryPrice + targetDistance;
    stopLoss = entryPrice - stopDistance;
  } else {
    target = entryPrice - targetDistance;
    stopLoss = entryPrice + stopDistance;
  }

  const roundedEntry = round(entryPrice, decimals);
  let roundedTarget = round(target, decimals);
  let roundedStop = round(stopLoss, decimals);

  if (trend === 'BUY') {
    if (roundedTarget <= roundedEntry) roundedTarget = round(roundedEntry + minTick, decimals);
    if (roundedStop >= roundedEntry) roundedStop = round(Math.max(minTick, roundedEntry - minTick), decimals);
  } else {
    if (roundedTarget >= roundedEntry) roundedTarget = round(Math.max(minTick, roundedEntry - minTick), decimals);
    if (roundedStop <= roundedEntry) roundedStop = round(roundedEntry + minTick, decimals);
  }

  const realizedRisk = Math.abs(roundedEntry - roundedStop);
  const realizedReward = Math.abs(roundedTarget - roundedEntry);
  const rr = realizedRisk > 0 ? realizedReward / realizedRisk : baseRr;

  const trailingActivationR = clamp(toNumber(context?.regimeContext?.regime === 'TRENDING' ? 1.1 : 1.4), 0.8, 2.5);
  const trailingStepAtr = clamp(toNumber(context?.regimeContext?.regime === 'BREAKOUT' ? 0.5 : 0.7), 0.25, 1.5);

  return {
    coin,
    type: trend,
    entryPrice: roundedEntry,
    target: roundedTarget,
    stopLoss: roundedStop,
    atr: round(safeAtr, decimals),
    strength: 70,
    riskModel: {
      regime,
      stopMultiplier: Number(baseStopMult.toFixed(3)),
      targetRR: Number(baseRr.toFixed(3)),
      realizedRR: Number(rr.toFixed(3)),
      trailing: {
        enabled: true,
        activationR: trailingActivationR,
        stepAtr: trailingStepAtr
      }
    }
  };
}

module.exports = {
  buildRiskManagedSignalData
};
