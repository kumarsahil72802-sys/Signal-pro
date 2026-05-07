const { settings } = require('../config');
const {
  calculateEMA,
  calculateBollingerBands,
  checkVolume,
  calculateATR
} = require('./indicators');

const {
  SIGNAL_EMA_PROXIMITY_PCT,
  SIGNAL_EMA_TEST_PCT,
  SIGNAL_REQUIRE_ZONE_REJECTION,
  SIGNAL_TRIGGER_SLOPE_MIN_ABS,
  SIGNAL_RANGING_SLOPE_MAX,
  SIGNAL_RANGING_BB_MAX
} = settings;

function calculateEMASlope(closes) {
  if (closes.length < 22) return 0;

  // Get EMA21 for last 3 candles
  const ema21Values = [];
  for (let i = 0; i < 3; i++) {
    const slice = closes.slice(0, -i);
    if (slice.length >= 21) {
      ema21Values.push(calculateEMA(slice, 21));
    }
  }

  if (ema21Values.length < 2) return 0;

  // Calculate slope as percentage change
  const slope = ((ema21Values[0] - ema21Values[ema21Values.length - 1]) / ema21Values[ema21Values.length - 1]) * 100;
  return slope;
}

/**
 * Detect price proximity to EMA zone
 * Price is "testing" EMA when within 0.3% of either EMA line
 * @param {number} currentPrice - Current price
 * @param {number} ema9 - EMA9 value
 * @param {number} ema21 - EMA21 value
 * @returns {Object} { nearEma9: boolean, nearEma21: boolean, proximityPct: number }
 */
function detectEMAProximity(currentPrice, ema9, ema21) {
  const PROXIMITY_THRESHOLD = SIGNAL_EMA_PROXIMITY_PCT;

  const distToEma9 = Math.abs(currentPrice - ema9) / currentPrice * 100;
  const distToEma21 = Math.abs(currentPrice - ema21) / currentPrice * 100;

  return {
    nearEma9: distToEma9 <= PROXIMITY_THRESHOLD,
    nearEma21: distToEma21 <= PROXIMITY_THRESHOLD,
    proximityPct: Math.min(distToEma9, distToEma21),
    distToEma9,
    distToEma21
  };
}

/**
 * Detect if price is within EMA zone (between EMA9 and EMA21)
 * @param {number} currentPrice - Current price
 * @param {number} ema9 - EMA9 value
 * @param {number} ema21 - EMA21 value
 * @returns {Object} { inZone: boolean, zonePosition: number }
 *   zonePosition: 0 = at EMA21, 1 = at EMA9, 0.5 = middle
 */
function detectEMAZone(currentPrice, ema9, ema21) {
  const minEma = Math.min(ema9, ema21);
  const maxEma = Math.max(ema9, ema21);

  if (currentPrice >= minEma && currentPrice <= maxEma) {
    const zoneWidth = maxEma - minEma;
    const position = zoneWidth > 0 ? (currentPrice - minEma) / zoneWidth : 0.5;
    return { inZone: true, zonePosition: position };
  }

  return { inZone: false, zonePosition: 0 };
}

/**
 * Detect price rejection (candle closes in opposite direction of wick)
 * Bullish rejection: close > open AND low touched/was near EMA
 * Bearish rejection: close < open AND high touched/was near EMA
 * @param {Object} currentCandle - Current kline candle
 * @param {string} direction - 'BUY' or 'SELL'
 * @returns {boolean} True if price shows rejection in expected direction
 */
function detectPriceRejection(currentCandle, direction) {
  const { open, close, high, low } = currentCandle;
  const bodySize = Math.abs(close - open);
  const totalRange = high - low;

  // Skip if candle is too small (doji-like)
  if (totalRange === 0 || bodySize / totalRange < 0.3) return false;

  if (direction === 'BUY') {
    // Bullish rejection: green candle, price bounced from lows
    return close > open;
  } else {
    // Bearish rejection: red candle, price rejected from highs
    return close < open;
  }
}

/**
 * Detect if price is testing EMA21 (pullback to EMA = high probability setup)
 * BUY: price was above EMA21, now pulled back to touch EMA21
 * SELL: price was below EMA21, now pulled up to touch EMA21
 * @param {number} currentPrice - Current price
 * @param {number} ema21 - EMA21 value
 * @param {string} direction - 'BUY' or 'SELL'
 * @returns {boolean} True if price is testing EMA21
 */
function detectEMATest(currentPrice, ema21, direction) {
  const TEST_THRESHOLD = 0.2; // 0.2% - very close to EMA21
  const distPct = Math.abs(currentPrice - ema21) / currentPrice * 100;

  if (direction === 'BUY') {
    // For BUY: price should be at or slightly below EMA21 (testing from above)
    return currentPrice <= ema21 && distPct <= TEST_THRESHOLD;
  } else {
    // For SELL: price should be at or slightly above EMA21 (testing from below)
    return currentPrice >= ema21 && distPct <= TEST_THRESHOLD;
  }
}

/**
 * Detect Bollinger Band Squeeze
 * @param {number[]} prices - Array of closing prices
 * @param {number} windowSize - Number of candles to check for squeeze (default 5-10)
 * @param {number} threshold - Bandwidth threshold (default 2%)
 * @returns {boolean} True if squeezed for the entire window
 */
function detectBBSqueeze(prices, windowSize = 8, threshold = 2.0) {
  if (prices.length < windowSize + 20) return false;

  for (let i = 0; i < windowSize; i++) {
    const historicalPrices = prices.slice(0, prices.length - i);
    const bb = calculateBollingerBands(historicalPrices);
    if (bb.bandwidth >= threshold) return false;
  }

  return true;
}

/**
 * Volatility Breakout Engine - ENHANCED
 * Detects moves before EMA crossover by identifying BB Squeezes
 * 
 * Improvements:
 * 1. Dynamic squeeze threshold based on ATR %
 * 2. 2-candle close confirmation logic
 * 3. Strength-based scoring (HIGH/MEDIUM/LOW)
 * 4. Retest detection
 * 
 * @param {Array} klines - Candle data
 * @returns {Object|null} Result or null
 */
function detectVolatilityBreakout(klines) {
  if (!klines || klines.length < 30) return null;

  const closes = klines.map(k => parseFloat(k.close));
  const currentPrice = closes[closes.length - 1];
  const currentCandle = klines[klines.length - 1];

  // 1. Calculate Dynamic Squeeze Threshold (ATR based)
  const atr = calculateATR(klines, 14);
  const atrPct = (atr / currentPrice) * 100;
  // Dynamic threshold: bandwidth must be tighter than 1.5x the current ATR percentage
  // capped at minimum 1.0% to avoid extreme micro-squeezes
  const squeezeThreshold = Math.max(1.0, atrPct * 1.5); 
  
  const isSqueezed = detectBBSqueeze(closes, 8, squeezeThreshold);
  if (!isSqueezed) return null;

  // 2. Get current BB
  const bb = calculateBollingerBands(closes);

  // 3. Detect Breakout Type
  let breakoutType = 'NONE';
  if (currentPrice > bb.upper) {
    breakoutType = 'BUY';
  } else if (currentPrice < bb.lower) {
    breakoutType = 'SELL';
  }

  if (breakoutType === 'NONE') return null;

  // 4. Confirmation logic (2 candle close OR strong body)
  const prevCloses = closes.slice(0, -1);
  const prevBB = calculateBollingerBands(prevCloses);
  const prevPrice = prevCloses[prevCloses.length - 1];
  
  const twoCandleClose = (breakoutType === 'BUY' && currentPrice > bb.upper && prevPrice > prevBB.upper) ||
                         (breakoutType === 'SELL' && currentPrice < bb.lower && prevPrice < prevBB.lower);

  const open = parseFloat(currentCandle.open);
  const close = parseFloat(currentCandle.close);
  const high = parseFloat(currentCandle.high);
  const low = parseFloat(currentCandle.low);
  const bodySize = Math.abs(close - open);
  const totalRange = high - low;
  const bodyStrength = totalRange > 0 ? bodySize / totalRange : 0;
  const strongBody = bodyStrength >= 0.7;

  // Breakout must be confirmed by either a 2-candle close OR a strong candle body
  const confirmed = twoCandleClose || strongBody;
  if (!confirmed) return null;

  // 5. Volume Confirmation (1.5x avg)
  const volResult = checkVolume(klines);
  const volumeConfirmed = volResult.ratio >= 1.5;

  // 6. Retest Detection (Price returning near broken band)
  const distToBand = breakoutType === 'BUY' 
    ? Math.abs(currentPrice - bb.upper) / currentPrice * 100
    : Math.abs(currentPrice - bb.lower) / currentPrice * 100;
  
  const isRetest = distToBand <= 0.2; // Within 0.2% of the breakout level

  // 7. Strength Classification & Scoring
  let strength = 'LOW';
  let confidenceContribution = 10;

  if (volumeConfirmed && confirmed) {
    // HIGH: Extreme volume + Double confirmation (Strong Body + 2 Candle Close)
    if (volResult.ratio >= 2.0 && (bodyStrength >= 0.8 && twoCandleClose)) {
      strength = 'HIGH';
      confidenceContribution = 35;
    } 
    // MEDIUM: Moderate volume + at least one confirmation
    else if (volResult.ratio >= 1.5 && (bodyStrength >= 0.7 || twoCandleClose)) {
      strength = 'MEDIUM';
      confidenceContribution = 25;
    }
  }

  // Calculate EMAs for compatibility with other engine scoring logic
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);

  return {
    trigger: 'VOLATILITY_BREAKOUT',
    trend: breakoutType,
    strength,
    confidenceContribution,
    ema9,
    ema21,
    slope: calculateEMASlope(closes),
    reason: `Volatility Breakout (${strength} strength${isRetest ? ' - Retest' : ''})`,
    meta: {
      bandWidth: bb.bandwidth.toFixed(2),
      squeezeThreshold: squeezeThreshold.toFixed(2),
      atrPct: atrPct.toFixed(2),
      volumeRatio: volResult.ratio.toFixed(2),
      bodyStrength: bodyStrength.toFixed(2),
      twoCandleClose,
      isRetest,
      isSqueezed
    }
  };
}

/**
 * NEW: Advanced signal trigger detection
 * Detects signals EARLIER than crossover by using proximity + slope + structure
 * 
 * Trigger types:
 * - 'EMA_TEST': Price testing EMA21 pullback (earliest, highest probability)
 * - 'EMA_ZONE': Price in EMA zone with structure
 * - 'CROSSOVER': Classic EMA crossover (kept for confirmation bonus)
 * 
 * @param {number[]} closes - Array of closing prices
 * @param {Object} klines - Current candle data for rejection detection
 * @returns {Object|null} { trigger: string, trend: 'BUY'|'SELL', ema9, ema21, slope, proximity, crossover } or null
 */
function detectAdvancedSignal(closes, klines) {
  if (closes.length < 22 || !klines || klines.length === 0) return null;

  const currentPrice = closes[closes.length - 1];
  const currentCandle = klines[klines.length - 1];

  // Calculate EMAs
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);

  // Calculate EMA slope (filter: must be > 0.1% to avoid flat markets)
  const slope = calculateEMASlope(closes);
  const absSlope = Math.abs(slope);
  const emaGapPct = Math.abs(ema9 - ema21) / currentPrice * 100;
  const hasStrongStructure = emaGapPct >= Math.max(0.2, SIGNAL_EMA_PROXIMITY_PCT * 0.6);

  // Check for classic crossover (for bonus scoring)
  const prevCloses = closes.slice(0, -1);
  const prevEma9 = calculateEMA(prevCloses, 9);
  const prevEma21 = calculateEMA(prevCloses, 21);
  const hasCrossover = (ema9 > ema21 && prevEma9 <= prevEma21) || (ema9 < ema21 && prevEma9 >= prevEma21);

  // Proximity and zone detection
  const proximity = detectEMAProximity(currentPrice, ema9, ema21);
  const zone = detectEMAZone(currentPrice, ema9, ema21);

  // Determine bullish/bearish structure
  const isBullishStructure = ema9 > ema21;
  const isBearishStructure = ema9 < ema21;

  // === BUY SIGNAL TRIGGERS ===
  // Trigger 1: Price testing EMA21 from above (pullback to EMA = buy opportunity)
  // AND EMA21 slope is positive (uptrend intact)
  if (slope > SIGNAL_TRIGGER_SLOPE_MIN_ABS || (isBullishStructure && hasStrongStructure)) {
    // Check EMA21 test (price pulled back to EMA21)
    const testingEma21 = currentPrice <= ema21 && Math.abs(currentPrice - ema21) / currentPrice * 100 <= SIGNAL_EMA_TEST_PCT;
    if (testingEma21) {
      return {
        trigger: 'EMA_TEST',
        trend: 'BUY',
        ema9,
        ema21,
        slope,
        proximity,
        zone,
        crossover: hasCrossover,
        reason: 'Price testing EMA21 pullback'
      };
    }

    // Trigger 2: Price in EMA zone + bullish structure + rejection
    if (zone.inZone && isBullishStructure) {
      const rejection = detectPriceRejection(currentCandle, 'BUY');
      if (!SIGNAL_REQUIRE_ZONE_REJECTION || rejection) {
        return {
          trigger: 'EMA_ZONE',
          trend: 'BUY',
          ema9,
          ema21,
          slope,
          proximity,
          zone,
          crossover: hasCrossover,
          reason: 'Price in EMA zone with bullish structure'
        };
      }
    }

    // Trigger 3: Classic crossover (highest confidence, but later)
    if (hasCrossover && ema9 > ema21) {
      return {
        trigger: 'CROSSOVER',
        trend: 'BUY',
        ema9,
        ema21,
        slope,
        proximity,
        zone,
        crossover: true,
        reason: 'EMA9 crossed above EMA21'
      };
    }
  }

  // === SELL SIGNAL TRIGGERS ===
  // Trigger 1: Price testing EMA21 from below (pullback to EMA = sell opportunity)
  // AND EMA21 slope is negative (downtrend intact)
  if (slope < -SIGNAL_TRIGGER_SLOPE_MIN_ABS || (isBearishStructure && hasStrongStructure)) {
    // Check EMA21 test (price pulled back to EMA21)
    const testingEma21 = currentPrice >= ema21 && Math.abs(currentPrice - ema21) / currentPrice * 100 <= SIGNAL_EMA_TEST_PCT;
    if (testingEma21) {
      return {
        trigger: 'EMA_TEST',
        trend: 'SELL',
        ema9,
        ema21,
        slope,
        proximity,
        zone,
        crossover: hasCrossover,
        reason: 'Price testing EMA21 pullback'
      };
    }

    // Trigger 2: Price in EMA zone + bearish structure + rejection
    if (zone.inZone && isBearishStructure) {
      const rejection = detectPriceRejection(currentCandle, 'SELL');
      if (!SIGNAL_REQUIRE_ZONE_REJECTION || rejection) {
        return {
          trigger: 'EMA_ZONE',
          trend: 'SELL',
          ema9,
          ema21,
          slope,
          proximity,
          zone,
          crossover: hasCrossover,
          reason: 'Price in EMA zone with bearish structure'
        };
      }
    }

    // Trigger 3: Classic crossover (highest confidence, but later)
    if (hasCrossover && ema9 < ema21) {
      return {
        trigger: 'CROSSOVER',
        trend: 'SELL',
        ema9,
        ema21,
        slope,
        proximity,
        zone,
        crossover: true,
        reason: 'EMA9 crossed below EMA21'
      };
    }
  }

  // No valid trigger (flat slope or no clear setup)
  return null;
}

/**
 * Detect trend using EMA crossover logic (legacy - kept for backward compatibility)
 * - BUY: ema9 > ema21 with fresh crossover
 * - SELL: ema9 < ema21 with fresh crossover
 * @param {number[]} closes - Array of closing prices (need 22+ for EMA 21 + previous)
 * @returns {Object|null} { trend: 'BUY'|'SELL', ema9: number, ema21: number } or null
 */
function detectTrend(closes) {
  if (closes.length < 22) return null;

  const currentEma9 = calculateEMA(closes, 9);
  const currentEma21 = calculateEMA(closes, 21);

  const prevCloses = closes.slice(0, -1);
  const prevEma9 = calculateEMA(prevCloses, 9);
  const prevEma21 = calculateEMA(prevCloses, 21);

  if (currentEma9 > currentEma21 && prevEma9 <= prevEma21) {
    return { trend: 'BUY', ema9: currentEma9, ema21: currentEma21 };
  }

  if (currentEma9 < currentEma21 && prevEma9 >= prevEma21) {
    return { trend: 'SELL', ema9: currentEma9, ema21: currentEma21 };
  }

  return null;
}

/**
 * Calculate EMA21 slope over last 5 candles for 4H timeframe
 * @param {number[]} closes - Array of closing prices (need 5+)
 * @returns {number} Slope as percentage (positive = bullish, negative = bearish)
 */

function detectMarketRegime(closes, ema9, ema21, slope) {
  const absSlope = Math.abs(slope);
  const bb = calculateBollingerBands(closes);
  
  // RANGING Condition: 
  // 1. Very flat slope AND
  // 2. Narrow bandwidth = Low volatility stagnation
  if (absSlope < SIGNAL_RANGING_SLOPE_MAX && bb.bandwidth < SIGNAL_RANGING_BB_MAX) {
    return 'RANGING';
  }

  // TRENDING Condition:
  // 1. Minimum slope required (>= 0.1%)
  // 2. EMA Alignment (9 above 21 for UP, 9 below 21 for DOWN)
  const isAligned = (ema9 > ema21 && slope > 0) || (ema9 < ema21 && slope < 0);
  
  if (absSlope >= 0.1 && isAligned) {
    return 'TRENDING';
  }

  // CONSOLIDATING Condition:
  // 1. Moderate slope (0.05% to <0.1%) OR
  // 2. Moderate bandwidth (1.5% to 3.0%)
  if ((absSlope >= 0.05 && absSlope < 0.1) || (bb.bandwidth >= 1.5 && bb.bandwidth <= 3.0)) {
    return 'CONSOLIDATING';
  }

  // Non-trending but not dead-flat: treat as consolidating (allow breakout setups)
  return 'CONSOLIDATING';
}


module.exports = {
  calculateEMASlope,
  detectEMAProximity,
  detectEMAZone,
  detectPriceRejection,
  detectEMATest,
  detectBBSqueeze,
  detectVolatilityBreakout,
  detectAdvancedSignal,
  detectTrend,
  detectMarketRegime
};
