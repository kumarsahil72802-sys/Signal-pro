const { getTopCoins } = require('../../coingeckoService');
const { settings } = require('../config');
const {
  calcMomentumAlignmentBonus
} = require('./indicators');

const {
  MIN_MOMENTUM_PCT
} = settings;

function calcRSIScore(rsi, trend) {
  if (trend === 'BUY') {
    if (rsi >= 30 && rsi <= 50) return 15; // oversold recovery - best BUY zone
    if (rsi > 50 && rsi <= 60) return 10; // neutral-bullish
    if (rsi > 60 && rsi <= 70) return 5; // getting overbought
    return 3; // extremes
  }
  if (trend === 'SELL') {
    if (rsi >= 50 && rsi <= 70) return 15; // overbought recovery - best SELL zone
    if (rsi >= 40 && rsi < 50) return 10; // neutral-bearish
    if (rsi >= 30 && rsi < 40) return 5; // getting oversold
    return 3; // extremes
  }
  return 5; // fallback
}

/**
 * Calculate MACD score (0-15)
 * - Strong alignment (histogram strong) → 15
 * - Weak alignment → 10
 * - Opposite → 5
 * @param {Object} macdData - MACD calculation result
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {number} MACD score
 */
function getMACDHistogramPercent(macdData, currentPrice) {
  if (!macdData || !Number.isFinite(macdData.histogram)) return 0;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;
  return (macdData.histogram / currentPrice) * 100;
}

function calcMACDScore(macdData, trend, currentPrice) {
  if (!macdData) return 5;
  
  const histogramPct = getMACDHistogramPercent(macdData, currentPrice);
  const isBullish = histogramPct > 0;
  const isBearish = histogramPct < 0;
  const histStrength = Math.abs(histogramPct);
  
  if (trend === 'BUY' && isBullish) {
    return histStrength >= 0.12 ? 15 : 10;
  }
  if (trend === 'SELL' && isBearish) {
    return histStrength >= 0.12 ? 15 : 10;
  }
  return 5;
}

/**
 * NEW: Calculate Trend (EMA) score with new trigger types (v2)
 * 
 * Scoring based on trigger type:
 * - CROSSOVER: 20 points (classic, highest reward, but later entry)
 * - EMA_ZONE: 16 points (price in EMA zone with structure)
 * - EMA_TEST: 12 points (price testing EMA21 pullback - earliest entry)
 * 
 * @param {Object} advancedSignal - Advanced signal detection result (from detectAdvancedSignal)
 * @param {number} momentum - Momentum percentage
 * @returns {number} Trend score
 */
function calcTrendScore(advancedSignal, momentum) {
  if (!advancedSignal) return 5;

  const { trigger, crossover, slope } = advancedSignal;
  const absMomentum = Math.abs(momentum);

  // Base score by trigger type (earlier triggers = lower base, but earlier entry)
  let baseScore = 5;
  switch (trigger) {
    case 'CROSSOVER':
      // Classic crossover - highest confidence, but later entry
      baseScore = 20;
      break;
    case 'EMA_ZONE':
      // Price in EMA zone with structure - good balance
      baseScore = 16;
      break;
    case 'EMA_TEST':
      // Price testing EMA21 pullback - earliest entry
      baseScore = 12;
      break;
    case 'VOLATILITY_BREAKOUT':
      // High momentum breakout from squeeze - very strong trigger
      baseScore = 20;
      break;
    default:
      baseScore = 5;
  }

  // Add momentum bonus if strong momentum
  if (absMomentum >= MIN_MOMENTUM_PCT) {
    baseScore = Math.max(baseScore, 15);
  }

  return baseScore;
}

/**
 * NEW: Calculate EMA slope bonus
 * Strong slope (>0.3%) adds confidence that trend is intact
 * @param {number} slope - EMA21 slope percentage
 * @returns {number} Bonus points (0 or +5)
 */
function calcEMASlopeBonus(slope) {
  const absSlope = Math.abs(slope);
  if (absSlope >= 0.3) return 5;  // Strong slope bonus
  if (absSlope >= 0.1) return 0;  // Minimum required for signal, no bonus
  return 0;  // Flat slope = no signal (filtered earlier)
}

/**
 * NEW: Calculate crossover confirmation bonus
 * If signal triggered early (EMA_TEST or EMA_ZONE) but crossover also happened,
 * add bonus points for confirmation
 * @param {Object} advancedSignal - Advanced signal detection result
 * @returns {number} Bonus points (0 or +15)
 */
function calcCrossoverConfirmationBonus(advancedSignal) {
  if (!advancedSignal) return 0;
  
  // If we have an early trigger AND crossover is happening, that's strong confirmation
  if (advancedSignal.trigger !== 'CROSSOVER' && advancedSignal.crossover) {
    return 15;  // Crossover as confirmation bonus
  }
  
  return 0;
}

/**
 * Calculate trend strength based on EMA gap distance
 * - Strong gap → +10
 * - Medium → +5
 * - Weak → 0
 * @param {Object} trendData - Trend detection result
 * @param {number} currentPrice - Current price
 * @returns {number} Bonus score
 */
function calcTrendStrengthBonus(trendData, currentPrice) {
  if (!trendData) return 0;

  if (trendData.trigger === 'VOLATILITY_BREAKOUT') {
    if (trendData.strength === 'HIGH') return 10;
    if (trendData.strength === 'MEDIUM') return 5;
    return 0;
  }

  const gapPercent = Math.abs(trendData.ema9 - trendData.ema21) / currentPrice * 100;

  if (gapPercent >= 1.0) return 10;  // Strong gap
  if (gapPercent >= 0.5) return 5;   // Medium gap
  return 0;                           // Weak gap
}

/**
 * Get trend strength level for penalty tracking
 * @param {Object} trendData - Trend detection result
 * @param {number} currentPrice - Current price
 * @returns {string} 'strong', 'moderate', or 'weak'
 */
function getTrendStrengthLevel(trendData, currentPrice) {
  if (!trendData) return 'weak';

  if (trendData.trigger === 'VOLATILITY_BREAKOUT') {
    return trendData.strength === 'HIGH' ? 'strong' : trendData.strength === 'MEDIUM' ? 'moderate' : 'weak';
  }

  const gapPercent = Math.abs(trendData.ema9 - trendData.ema21) / currentPrice * 100;

  if (gapPercent >= 1.0) return 'strong';
  if (gapPercent >= 0.3) return 'moderate';
  return 'weak';
}

/**
 * Calculate Volume score (0-15) - UPDATED with Volume Delta
 * Step 1: Calculate base volume score
 *   - volume > 1.5x average → baseScore = 15
 *   - volume > 1.2x average → baseScore = 8
 *   - else → baseScore = 3
 * 
 * Step 2: Apply direction filter based on volume delta
 * For BUY signals:
 *   - buyDominant → volumeScore = baseScore (full score, confirmed)
 *   - neutral → volumeScore = baseScore × 0.5 (half score)
 *   - sellDominant → volumeScore = 0 (penalize, wrong direction)
 * 
 * For SELL signals:
 *   - sellDominant → volumeScore = baseScore (full score, confirmed)
 *   - neutral → volumeScore = baseScore × 0.5 (half score)
 *   - buyDominant → volumeScore = 0 (penalize, wrong direction)
 * 
 * @param {Object} volumeData - Volume check result
 * @param {Object} volumeDelta - Volume delta result from calculateVolumeDelta
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {number} Volume score
 */
function calcVolumeScore(volumeData, volumeDelta, trend) {
  if (!volumeData || volumeData.current === 0) return 5;

  const ratio = volumeData.current / (volumeData.average || 1);

  let baseScore = 3;
  if (ratio >= 1.5) baseScore = 15;
  else if (ratio >= 1.2) baseScore = 8;

  if (trend === 'BUY') {
    if (volumeDelta.buyDominant) {
      return baseScore;
    } else if (volumeDelta.neutral) {
      return Math.round(baseScore * 0.5);
    } else {
      return 2;
    }
  } else if (trend === 'SELL') {
    if (volumeDelta.sellDominant) {
      return baseScore;
    } else if (volumeDelta.neutral) {
      return Math.round(baseScore * 0.5);
    } else {
      return 2;
    }
  }

  return baseScore;
}

/**
 * Calculate Bollinger Bands score (0-10)
 * - Expanding → 10
 * - Normal → 7
 * - Tight → 3
 * @param {number} widthPercent - BB width as percentage
 * @param {boolean} isExpanding - Whether BB width is expanding
 * @returns {number} BB score
 */
function calcBBScore(widthPercent, isExpanding) {
  if (isExpanding) return 10;
  if (widthPercent >= 2) return 7;
  return 3;
}

/**
 * Calculate Multi-timeframe score (0-10)
 * - 1H + 4H same → 10
 * - Slight mismatch → 5
 * - Opposite → 0
 * @param {string} trend - Current 1H trend
 * @param {string|null} higherTrend - 4H trend
 * @returns {number} Multi-timeframe score
 */
function calcMultiTimeframeScore(trend, higherTrend) {
  if (!higherTrend) return 5;
  if (trend === higherTrend) return 10;
  
  // Check for slight mismatch based on EMA distance
  return 5;
}

/**
 * Calculate technical score (normalized to 100) - UPDATED for v2 trigger logic + Volume Delta
 *
 * Components:
 * - RSI: 0-15
 * - MACD: 0-15
 * - Trend (EMA): 0-20 (now uses advanced signal with trigger types)
 * - Volume: 0-15 (now includes Volume Delta direction filtering)
 * - Bollinger Bands: 0-10
 * - Multi-timeframe: 0-10
 *
 * NEW Bonuses (v2):
 * - EMA Slope bonus: +5 (strong slope >0.3%)
 * - Crossover confirmation: +15 (early trigger + crossover happened)
 * - Volume Delta direction is included in volume scoring
 *
 * Total max: 115 → normalized to 100
 *
 * @param {Object} params - All indicator data
 * @returns {number} Normalized technical score (0-100)
 */
function calcTechnicalScore(params) {
  const { advancedSignal, momentum, volumeData, volumeDelta, rsi, macdData, bbWidthPercent, bbExpanding, higherTrend, shortTermMomentum, midTermMomentum, currentPrice } = params;

  // Use advanced signal for trend scoring (new v2 logic)
  const trend = advancedSignal?.trend;

  const rsiScore = calcRSIScore(rsi, trend);
  const macdScore = calcMACDScore(macdData, trend, currentPrice);
  const trendScore = calcTrendScore(advancedSignal, momentum);
  const volumeScore = calcVolumeScore(volumeData, volumeDelta, trend);
  const bbScore = calcBBScore(bbWidthPercent, bbExpanding);
  const mtScore = calcMultiTimeframeScore(trend, higherTrend);

  // Add minimum strength condition bonuses
  const momentumBonus = calcMomentumAlignmentBonus(shortTermMomentum, midTermMomentum, trend);
  const trendStrengthBonus = calcTrendStrengthBonus(advancedSignal, currentPrice);

  // NEW: Add EMA slope bonus and crossover confirmation bonus (v2)
  const emaSlopeBonus = calcEMASlopeBonus(advancedSignal?.slope || 0);
  const crossoverBonus = calcCrossoverConfirmationBonus(advancedSignal);

  const rawScore = rsiScore + macdScore + trendScore + volumeScore + bbScore + mtScore + momentumBonus + trendStrengthBonus + emaSlopeBonus + crossoverBonus;
  const maxRawScore = 115; // 85 + 10 (momentum) + 10 (trend strength) + 5 (EMA slope) + 15 (crossover)

  // Normalize to 100
  return Math.min(100, Math.round((rawScore / maxRawScore) * 100));
}

/**
 * Count weak indicators and calculate penalty
 * - 2+ weak → -10 confidence
 * - 3+ weak → -20 confidence
 * @param {Object} indicators - Object with strength levels
 * @returns {number} Penalty to apply
 */
function calcWeakIndicatorPenalty(indicators) {
  const weakCount = Object.values(indicators).filter(level => level === 'weak').length;

  if (weakCount >= 3) return -20;
  if (weakCount >= 2) return -10;
  return 0;
}

/**
 * Get RSI strength level for penalty tracking
 * @param {number} rsi - RSI value
 * @returns {string} 'strong', 'moderate', or 'weak'
 */
function getRSIStrengthLevel(rsi) {
  if (rsi >= 45 && rsi <= 55) return 'strong';
  if ((rsi >= 35 && rsi < 45) || (rsi > 55 && rsi <= 65)) return 'moderate';
  return 'weak';
}

/**
 * Get MACD strength level for penalty tracking
 * @param {Object} macdData - MACD calculation result
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {string} 'strong', 'moderate', or 'weak'
 */
function getMACDStrengthLevel(macdData, trend, currentPrice) {
  if (!macdData) return 'weak';

  const histogramPct = getMACDHistogramPercent(macdData, currentPrice);
  const isBullish = histogramPct > 0;
  const isBearish = histogramPct < 0;
  const histStrength = Math.abs(histogramPct);

  if (trend === 'BUY' && isBullish) return histStrength >= 0.12 ? 'strong' : 'moderate';
  if (trend === 'SELL' && isBearish) return histStrength >= 0.12 ? 'strong' : 'moderate';
  return 'weak';
}

// ============================================================================
// CONFIDENCE BOOST SYSTEM
// ============================================================================

/**
 * Calculate confidence boost based on multi-timeframe alignment
 * 1H + 4H same direction → +10
 * @param {string} trend - Current 1H trend
 * @param {string|null} higherTrend - 4H trend
 * @returns {number} Boost score
 */
function calcMultiTimeframeBoost(trend, higherTrend) {
  if (!higherTrend) return 0;
  if (trend === higherTrend) return 10;
  return 0;
}

/**
 * Calculate confidence boost based on strong MACD histogram
 * Strong histogram → +5
 * @param {Object} macdData - MACD calculation result
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {number} Boost score
 */
function calcMACDStrengthBoost(macdData, trend, currentPrice) {
  if (!macdData) return 0;
  const histogramPct = getMACDHistogramPercent(macdData, currentPrice);
  const aligned = (trend === 'BUY' && histogramPct > 0) || (trend === 'SELL' && histogramPct < 0);
  if (aligned && Math.abs(histogramPct) >= 0.18) return 5;
  return 0;
}

/**
 * Calculate confidence boost based on RSI momentum (rising fast)
 * RSI moving strongly in trend direction → +5
 * @param {number} rsi - Current RSI
 * @param {number[]} rsiHistory - Previous RSI values
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {number} Boost score
 */
function calcRSIMomentumBoost(rsi, rsiHistory, trend) {
  if (!rsiHistory || rsiHistory.length < 3) return 0;
  const rsiChange = rsi - rsiHistory[0];
  if (trend === 'BUY' && rsiChange > 5) return 5;
  if (trend === 'SELL' && rsiChange < -5) return 5;
  return 0;
}

/**
 * Calculate confidence boost based on Bollinger expansion
 * BB expanding → +5
 * @param {boolean} bbExpanding - Whether BB is expanding
 * @returns {number} Boost score
 */
function calcBollingerExpansionBoost(bbExpanding) {
  return bbExpanding ? 5 : 0;
}

/**
 * Calculate total confidence boost
 * @param {Object} params - All indicator data
 * @returns {number} Total boost score
 */
function calcConfidenceBoost(params) {
  const { trendData, higherTrend, macdData, rsi, rsiHistory, bbExpanding, currentPrice } = params;
  const mtBoost = calcMultiTimeframeBoost(trendData?.trend, higherTrend);
  const macdBoost = calcMACDStrengthBoost(macdData, trendData?.trend, currentPrice);
  const rsiBoost = calcRSIMomentumBoost(rsi, rsiHistory, trendData?.trend);
  const bbBoost = calcBollingerExpansionBoost(bbExpanding);
  return mtBoost + macdBoost + rsiBoost + bbBoost;
}

function hasStrongIndicatorConflict({ trend, macdData, currentPrice, shortTermMomentum, midTermMomentum, volumeDelta }) {
  const histogramPct = getMACDHistogramPercent(macdData, currentPrice);
  const macdOpposite = (trend === 'BUY' && histogramPct < -0.05) || (trend === 'SELL' && histogramPct > 0.05);
  const momentumOpposite = (trend === 'BUY' && shortTermMomentum < -0.25 && midTermMomentum < -0.15) ||
    (trend === 'SELL' && shortTermMomentum > 0.25 && midTermMomentum > 0.15);
  const volumeOpposite = (trend === 'BUY' && volumeDelta.sellDominant) || (trend === 'SELL' && volumeDelta.buyDominant);
  return macdOpposite && momentumOpposite && volumeOpposite;
}

// ============================================================================
// CONFIDENCE PENALTY SYSTEM
// ============================================================================

/**
 * Calculate penalty for extreme RSI (<30 or >70)
 * @param {number} rsi - RSI value
 * @returns {number} Penalty score (negative)
 */

module.exports = {
  calcRSIScore,
  getMACDHistogramPercent,
  calcMACDScore,
  calcTrendScore,
  calcEMASlopeBonus,
  calcCrossoverConfirmationBonus,
  calcTrendStrengthBonus,
  getTrendStrengthLevel,
  calcVolumeScore,
  calcBBScore,
  calcMultiTimeframeScore,
  calcTechnicalScore,
  calcWeakIndicatorPenalty,
  getRSIStrengthLevel,
  getMACDStrengthLevel,
  calcMultiTimeframeBoost,
  calcMACDStrengthBoost,
  calcRSIMomentumBoost,
  calcBollingerExpansionBoost,
  calcConfidenceBoost,
  hasStrongIndicatorConflict
};
