const {
  settings,
  getConfidenceThreshold,
  getEffectiveConfidenceThreshold
} = require('../config');

const {
  MIN_MOMENTUM_PCT,
  SIGNAL_THRESHOLD_OFFSET
} = settings;

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

function roundToDecimals(value, decimals) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return 0;
  return Number(safeValue.toFixed(decimals));
}

function applyPricePrecision(value, entryPrice, decimals) {
  const rounded = roundToDecimals(value, decimals);
  const minTick = Math.pow(10, -decimals);
  if (rounded <= 0) return minTick;

  // Never allow a rounded price to collapse into a non-finite number.
  if (!Number.isFinite(rounded)) {
    return Math.max(minTick, roundToDecimals(entryPrice, decimals));
  }

  return rounded;
}

function buildSignalData(coin, type, entryPrice, atr) {
  if (!atr || atr <= 0) {
    atr = entryPrice * 0.007;  // Fallback to ~0.7% if ATR unavailable
  }

  const targetOffset = atr * 1.5;
  const stopOffset = atr * 1;
  const decimals = resolvePriceDecimals(entryPrice);
  const minTick = Math.pow(10, -decimals);
  const roundedEntry = applyPricePrecision(entryPrice, entryPrice, decimals);

  if (type === 'BUY') {
    let roundedTarget = applyPricePrecision(entryPrice + targetOffset, entryPrice, decimals);
    let roundedStop = applyPricePrecision(entryPrice - stopOffset, entryPrice, decimals);

    if (roundedTarget <= roundedEntry) {
      roundedTarget = roundToDecimals(roundedEntry + minTick, decimals);
    }
    if (roundedStop >= roundedEntry) {
      roundedStop = roundToDecimals(Math.max(minTick, roundedEntry - minTick), decimals);
    }

    return {
      coin,
      type,
      entryPrice: roundedEntry,
      target: roundedTarget,
      stopLoss: roundedStop,
      atr: roundToDecimals(atr, decimals),
      strength: 70
    };
  }

  let roundedTarget = applyPricePrecision(entryPrice - targetOffset, entryPrice, decimals);
  let roundedStop = applyPricePrecision(entryPrice + stopOffset, entryPrice, decimals);

  if (roundedTarget >= roundedEntry) {
    roundedTarget = roundToDecimals(Math.max(minTick, roundedEntry - minTick), decimals);
  }
  if (roundedStop <= roundedEntry) {
    roundedStop = roundToDecimals(roundedEntry + minTick, decimals);
  }

  return {
    coin,
    type,
    entryPrice: roundedEntry,
    target: roundedTarget,
    stopLoss: roundedStop,
    atr: roundToDecimals(atr, decimals),
    strength: 70
  };
}

// ============================================================================
// MAIN SIGNAL GENERATION
// ============================================================================

/**
 * Get human-readable reason strings for signal factors - UPDATED for v2
 * Now includes trigger type in the reason output
 */
function getReasonLabels(advancedSignal, momentum, volumeData, rsi) {
  // Trend reason - now includes trigger type
  let trendReason = 'NEUTRAL';
  if (advancedSignal) {
    const trigger = advancedSignal.trigger || 'UNKNOWN';
    const direction = advancedSignal.trend === 'BUY' ? 'UPTREND' : 'DOWNTREND';
    trendReason = `${direction}(${trigger})`;
  }

  // Momentum reason
  let momentumReason = 'WEAK';
  const absMomentum = Math.abs(momentum);
  if (absMomentum >= 2) momentumReason = 'STRONG';
  else if (absMomentum >= MIN_MOMENTUM_PCT) momentumReason = 'MODERATE';

  // Volume reason
  const volumeReason = volumeData.valid
    ? (volumeData.score >= 12 ? 'HIGH' : 'MODERATE')
    : 'LOW';

  // RSI classification
  let rsiLabel = 'NEUTRAL';
  if (rsi > 70) rsiLabel = 'OVERBOUGHT';
  else if (rsi < 30) rsiLabel = 'OVERSOLD';
  else if (rsi > 55) rsiLabel = 'BULLISH';
  else if (rsi < 45) rsiLabel = 'BEARISH';

  return {
    trend: trendReason,
    momentum: momentumReason,
    volume: volumeReason,
    rsi: rsiLabel,
    rsiValue: Math.round(rsi)
  };
}

/**
 * Determine signal quality level based on confidence
 * 85+ → STRONG
 * 70-84 → GOOD
 * 55-69 → MODERATE
 * 50-54 → WEAK
 * <50 → reject
 * @param {number} confidence - Confidence score
 * @returns {string|null} Signal quality or null if rejected
 */
function getSignalQuality(confidence) {
  if (confidence >= 85) return 'STRONG';
  if (confidence >= 70) return 'GOOD';
  if (confidence >= 55) return 'MODERATE';
  if (confidence >= 50) return 'WEAK';
  return null;
}

/**
 * Quality filter check - returns { passed: boolean, reason: string }
 * Rejects if confidence falls below hard floor (50)
 */
function runQualityFilters(confidence, volumeData, momentum) {
  // Hard floor: never allow signal generation below 50 confidence.
  if (confidence < 50) {
    return { passed: false, reason: 'Confidence below hard minimum (50)' };
  }

  // Dynamic threshold check for higher quality signals
  const effectiveThreshold = getEffectiveConfidenceThreshold();
  if (confidence < effectiveThreshold) {
    return {
      passed: false,
      reason: `Below effective threshold (${effectiveThreshold} = base ${getConfidenceThreshold()} + offset ${SIGNAL_THRESHOLD_OFFSET})`
    };
  }

  return { passed: true, reason: 'Quality checks passed' };
}

function applyExecutionQualityAdjustment(confidence, qualityData) {
  if (!qualityData || qualityData.unavailable) {
    return {
      adjustedConfidence: confidence,
      adjustment: 0,
      shouldBlock: false,
      reason: 'execution quality unavailable (fail-open)'
    };
  }

  const executionQuality = String(qualityData.executionQuality || '').toUpperCase();
  const slippageRisk = String(qualityData.slippageRisk || '').toUpperCase();

  const riskyExecution = executionQuality === 'RISKY';
  const highSlippage = slippageRisk === 'HIGH';
  const goodExecution = executionQuality === 'GOOD';
  const lowSlippage = slippageRisk === 'LOW';

  let adjustment = 0;
  if (riskyExecution && highSlippage) {
    adjustment = -20;
  } else if (riskyExecution || highSlippage) {
    adjustment = -10;
  } else if (goodExecution && lowSlippage) {
    adjustment = 4;
  }

  const adjustedConfidence = Math.max(0, Math.min(100, confidence + adjustment));
  const hardBlockFloor = Math.max(getEffectiveConfidenceThreshold() + 4, 64);
  const shouldBlock = riskyExecution && highSlippage && adjustedConfidence < hardBlockFloor;

  return {
    adjustedConfidence,
    adjustment,
    shouldBlock,
    reason: `execution:${executionQuality || 'UNKNOWN'} slippage:${slippageRisk || 'UNKNOWN'}`
  };
}

module.exports = {
  buildSignalData,
  getReasonLabels,
  getSignalQuality,
  runQualityFilters,
  applyExecutionQualityAdjustment
};

