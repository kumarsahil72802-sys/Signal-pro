function calculateSMA(closes) {
  if (closes.length === 0) return 0;
  const sum = closes.reduce((a, b) => a + b, 0);
  return sum / closes.length;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param {number[]} prices - Array of closing prices
 * @param {number} period - EMA period (e.g., 9, 21)
 * @returns {number} Latest EMA value
 */
function calculateEMA(prices, period) {
  if (prices.length < period) return 0;

  const multiplier = 2 / (period + 1);

  const firstSMA = calculateSMA(prices.slice(0, period));
  let ema = firstSMA;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate Standard Deviation
 * @param {number[]} values - Array of numbers
 * @returns {number} Standard deviation
 */
function calculateStandardDeviation(values) {
  if (values.length === 0) return 0;
  const avg = calculateSMA(values);
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  const avgSquareDiff = calculateSMA(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

/**
 * Calculate Bollinger Bands
 * @param {number[]} prices - Array of closing prices
 * @param {number} period - Period (default 20)
 * @param {number} multiplier - Multiplier (default 2)
 * @returns {Object} { middle, upper, lower, bandwidth }
 */
function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  if (prices.length < period) {
    return { middle: 0, upper: 0, lower: 0, bandwidth: 0 };
  }

  const slice = prices.slice(-period);
  const middle = calculateSMA(slice);
  const stdDev = calculateStandardDeviation(slice);

  const upper = middle + (multiplier * stdDev);
  const lower = middle - (multiplier * stdDev);
  const bandwidth = middle !== 0 ? ((upper - lower) / middle) * 100 : 0;

  return { middle, upper, lower, bandwidth };
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {number[]} prices - Array of closing prices
 * @returns {Object} { macdLine, signalLine, histogram }
 */
function calculateMACD(prices) {
  if (prices.length < 26) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  const macdLine = ema12 - ema26;

  const macdHistory = [];
  for (let i = 25; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    const e12 = calculateEMA(slice, 12);
    const e26 = calculateEMA(slice, 26);
    macdHistory.push(e12 - e26);
  }

  const signalLine = calculateEMA(macdHistory, 9);
  const histogram = macdLine - signalLine;

  return { macdLine, signalLine, histogram };
}

/**
 * NEW TRIGGER LOGIC (v2): Early signal detection using proximity and slope
 * 
 * Problem: EMA crossover is lagging - by the time it triggers, 40-60% of move is done
 * Solution: Detect signals EARLIER using:
 *   1. Price approaching EMA zone (proximity)
 *   2. EMA slope analysis (trend strength filter)
 *   3. Crossover as CONFIRMATION bonus (not required)
 */

/**
 * Calculate EMA21 slope over last 3 candles
 * Used to filter signals in flat markets and confirm trend direction
 * @param {number[]} closes - Array of closing prices (need 22+)
 * @returns {number} Slope as percentage (positive = bullish, negative = bearish)
 */

function calculateMomentum(closes) {
  if (closes.length < 2) return 0;
  const first = closes[0];
  const last = closes[closes.length - 1];
  return ((last - first) / first) * 100;
}

/**
 * Calculate short-term momentum (last 3 candles)
 * @param {number[]} closes - Array of closing prices
 * @returns {number} Momentum percentage
 */
function calculateShortTermMomentum(closes) {
  if (closes.length < 3) return 0;
  const recent = closes.slice(-3);
  return ((recent[2] - recent[0]) / recent[0]) * 100;
}

/**
 * Calculate mid-term momentum (last 10 candles)
 * @param {number[]} closes - Array of closing prices
 * @returns {number} Momentum percentage
 */
function calculateMidTermMomentum(closes) {
  if (closes.length < 10) return 0;
  const recent = closes.slice(-10);
  return ((recent[9] - recent[0]) / recent[0]) * 100;
}

/**
 * Get momentum alignment bonus/penalty
 * - Both aligned → +10
 * - Only one aligned → +5
 * - Opposite → -5
 * @param {number} shortTermMomentum - Short-term momentum
 * @param {number} midTermMomentum - Mid-term momentum
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {number} Bonus/penalty score
 */
function calcMomentumAlignmentBonus(shortTermMomentum, midTermMomentum, trend) {
  const shortAligned = (trend === 'BUY' && shortTermMomentum > 0) || (trend === 'SELL' && shortTermMomentum < 0);
  const midAligned = (trend === 'BUY' && midTermMomentum > 0) || (trend === 'SELL' && midTermMomentum < 0);

  if (shortAligned && midAligned) return 10;
  if (shortAligned || midAligned) return 5;
  return -5;
}

/**
 * Get momentum strength level for penalty tracking
 * @param {number} shortTermMomentum - Short-term momentum
 * @param {number} midTermMomentum - Mid-term momentum
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {string} 'strong', 'moderate', or 'weak'
 */
function getMomentumStrengthLevel(shortTermMomentum, midTermMomentum, trend) {
  const threshold = 0.5;
  const shortAligned = (trend === 'BUY' && shortTermMomentum > threshold) || (trend === 'SELL' && shortTermMomentum < -threshold);
  const midAligned = (trend === 'BUY' && midTermMomentum > threshold) || (trend === 'SELL' && midTermMomentum < -threshold);

  if (shortAligned && midAligned) return 'strong';
  if (shortAligned || midAligned || Math.abs(shortTermMomentum) >= threshold || Math.abs(midTermMomentum) >= threshold) return 'moderate';
  return 'weak';
}

/**
 * Calculate RSI (Relative Strength Index) - Wilder's 14-period
 * @param {number[]} closes - Array of closing prices
 * @returns {number} RSI value (0-100)
 */
function calculateRSI(closes) {
  const RSI_PERIOD = 14;

  if (closes.length < RSI_PERIOD + 1) {
    return 50;
  }

  const periodCloses = closes.slice(-RSI_PERIOD - 1);

  let gains = [];
  let losses = [];

  for (let i = 1; i < periodCloses.length; i++) {
    const change = periodCloses[i] - periodCloses[i - 1];
    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }
  }

  let avgGain = gains.slice(0, RSI_PERIOD).reduce((a, b) => a + b, 0) / RSI_PERIOD;
  let avgLoss = losses.slice(0, RSI_PERIOD).reduce((a, b) => a + b, 0) / RSI_PERIOD;

  for (let i = RSI_PERIOD; i < gains.length; i++) {
    avgGain = (avgGain * (RSI_PERIOD - 1) + gains[i]) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + losses[i]) / RSI_PERIOD;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Check volume confirmation
 * Current volume must be above average volume
 * @param {Array} klines - Candle data with volume
 * @returns {Object} { valid: boolean, current: number, average: number, score: number, ratio: number, isSpike: boolean, isBelowAvg: boolean }
 */
function checkVolume(klines) {
  if (klines.length < 2) {
    return { valid: false, current: 0, average: 0, score: 0, ratio: 0, isSpike: false, isBelowAvg: true };
  }

  const volumes = klines.map(k => k.volume);
  const currentVolume = volumes[volumes.length - 1];
  const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);

  const ratio = currentVolume / (avgVolume || 1);
  const valid = currentVolume >= avgVolume;
  const isSpike = ratio >= 1.5;
  const isBelowAvg = ratio < 1.0;

  // Volume score: 0-15 based on how much above average
  const score = valid ? Math.min(15, Math.round(ratio * 10)) : 0;

  return { valid, current: currentVolume, average: avgVolume, score, ratio, isSpike, isBelowAvg };
}

/**
 * Calculate Volume Delta - analyzes buying vs selling pressure per candle
 * Volume Delta = Buying Volume vs Selling Volume per candle
 * - buyVol = volume × ((close - low) / (high - low))
 * - sellVol = volume × ((high - close) / (high - low))
 * 
 * @param {Array} candles - Array of candle objects with high, low, close, volume
 * @returns {Object} { deltaRatio, buyDominant, sellDominant, neutral }
 */
function calculateVolumeDelta(candles) {
  if (!candles || candles.length < 5) {
    return { deltaRatio: 0.5, buyDominant: false, sellDominant: false, neutral: true };
  }

  const last5Candles = candles.slice(-5);
  let totalBuyVolume = 0;
  let totalSellVolume = 0;

  for (const candle of last5Candles) {
    const high = parseFloat(candle.high);
    const low = parseFloat(candle.low);
    const close = parseFloat(candle.close);
    const volume = parseFloat(candle.volume);

    const range = high - low;

    if (range === 0) {
      totalBuyVolume += volume * 0.5;
      totalSellVolume += volume * 0.5;
    } else {
      const buyVol = volume * ((close - low) / range);
      const sellVol = volume * ((high - close) / range);
      totalBuyVolume += buyVol;
      totalSellVolume += sellVol;
    }
  }

  const totalVolume = totalBuyVolume + totalSellVolume;
  if (totalVolume === 0) {
    return { deltaRatio: 0.5, buyDominant: false, sellDominant: false, neutral: true };
  }

  const deltaRatio = totalBuyVolume / totalVolume;

  return {
    deltaRatio,
    buyDominant: deltaRatio > 0.6,
    sellDominant: deltaRatio < 0.4,
    neutral: deltaRatio >= 0.4 && deltaRatio <= 0.6
  };
}

/**
 * Get volume bonus based on spike detection - UPDATED with Volume Delta
 * - Spike (>1.5x) + direction confirmed → +10
 * - Spike (>1.5x) + neutral → +5
 * - Spike (>1.5x) + wrong direction → 0 + -8 penalty
 * - Below average → -5
 * @param {Object} volumeData - Volume check result
 * @param {Object} volumeDelta - Volume delta result from calculateVolumeDelta
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {Object} { bonus: number, penalty: number }
 */
function calcVolumeSpikeBonus(volumeData, volumeDelta, trend) {
  if (!volumeData) return { bonus: 0, penalty: 0 };

  if (volumeData.isSpike) {
    if (trend === 'BUY' && volumeDelta.buyDominant) {
      return { bonus: 10, penalty: 0 };
    } else if (trend === 'SELL' && volumeDelta.sellDominant) {
      return { bonus: 10, penalty: 0 };
    } else if (volumeDelta.neutral) {
      return { bonus: 5, penalty: 0 };
    } else {
      return { bonus: 0, penalty: -8 };
    }
  }

  if (volumeData.isBelowAvg) return { bonus: -5, penalty: 0 };
  return { bonus: 0, penalty: 0 };
}

/**
 * Get volume strength level for penalty tracking
 * @param {Object} volumeData - Volume check result
 * @returns {string} 'strong', 'moderate', or 'weak'
 */
function getVolumeStrengthLevel(volumeData) {
  if (!volumeData || volumeData.current === 0) return 'weak';
  if (volumeData.isSpike) return 'strong';
  if (volumeData.ratio >= 1.0) return 'moderate';
  return 'weak';
}

/**
 * Calculate ATR (Average True Range) - Wilder's smoothing method
 * @param {Array} candles - Array of candle objects with high, low, close
 * @param {number} period - ATR period (default 14)
 * @returns {number} Latest ATR value
 */
function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) {
    return 0;
  }

  const trValues = [];

  for (let i = 0; i < candles.length; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const close = parseFloat(candles[i].close);

    let tr;
    if (i === 0) {
      tr = high - low;
    } else {
      const prevClose = parseFloat(candles[i - 1].close);
      tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
    }
    trValues.push(tr);
  }

  const recentTR = trValues.slice(-period - 1);

  let atr = recentTR.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < recentTR.length; i++) {
    atr = (atr * (period - 1) + recentTR[i]) / period;
  }

  return atr;
}


module.exports = {
  calculateSMA,
  calculateEMA,
  calculateStandardDeviation,
  calculateBollingerBands,
  calculateMACD,
  calculateMomentum,
  calculateShortTermMomentum,
  calculateMidTermMomentum,
  calcMomentumAlignmentBonus,
  getMomentumStrengthLevel,
  calculateRSI,
  checkVolume,
  calculateVolumeDelta,
  calcVolumeSpikeBonus,
  getVolumeStrengthLevel,
  calculateATR
};
