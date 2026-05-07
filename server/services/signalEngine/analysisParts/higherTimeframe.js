const { getKlines } = require('../../binanceService');
const { calculateEMA } = require('./indicators');

function calculate4HEMASlope(closes) {
  if (closes.length < 6) return 0;

  // Get EMA21 for last 5 candles
  const ema21Values = [];
  for (let i = 0; i < 5; i++) {
    const slice = closes.slice(0, -i);
    if (slice.length >= 21) {
      ema21Values.push(calculateEMA(slice, 21));
    }
  }

  if (ema21Values.length < 2) return 0;

  // Calculate slope as percentage change: ((ema21[last] - ema21[last-5]) / ema21[last-5]) × 100
  const slope = ((ema21Values[0] - ema21Values[ema21Values.length - 1]) / ema21Values[ema21Values.length - 1]) * 100;
  return slope;
}

/**
 * Detect 4H higher timeframe trend with strength classification
 * Used for both bonus points (via calcMultiTimeframeScore) and hard filtering
 *
 * Trend classification:
 * - EMA9 > EMA21 AND slope > +0.5% → bullish strong
 * - EMA9 > EMA21 AND slope > +0.1% → bullish moderate
 * - EMA9 > EMA21 AND slope <= +0.1% → bullish weak (treat as neutral)
 * - EMA9 < EMA21 AND slope < -0.5% → bearish strong
 * - EMA9 < EMA21 AND slope < -0.1% → bearish moderate
 * - EMA9 < EMA21 AND slope >= -0.1% → bearish weak (treat as neutral)
 * - EMA9 ≈ EMA21 (within 0.1%) → neutral
 *
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @returns {Promise<Object|null>} { trend: 'bullish'|'bearish'|'neutral', strength: 'strong'|'moderate'|'weak', ema21Slope: number } or null
 */
async function detect4HTrend(symbol) {
  try {
    const klines4h = await getKlines(symbol, '4h', 100);
    if (!klines4h || klines4h.length < 21) {
      console.log(`[Engine] ${symbol} 4H: Insufficient data`);
      return null;
    }

    const closes4h = klines4h.map(k => k.close);
    const ema9_4h = calculateEMA(closes4h, 9);
    const ema21_4h = calculateEMA(closes4h, 21);
    const ema21Slope = calculate4HEMASlope(closes4h);

    // Determine trend based on EMA9 vs EMA21 position
    const emaGapPercent = Math.abs(ema9_4h - ema21_4h) / ema21_4h * 100;
    let trend = 'neutral';
    let strength = 'weak';

    if (emaGapPercent < 0.1) {
      // EMA9 ≈ EMA21 (within 0.1%) → neutral
      trend = 'neutral';
      strength = 'weak';
    } else if (ema9_4h > ema21_4h) {
      // Bullish: EMA9 above EMA21
      if (ema21Slope > 0.5) {
        trend = 'bullish';
        strength = 'strong';
      } else if (ema21Slope > 0.1) {
        trend = 'bullish';
        strength = 'moderate';
      } else {
        // slope <= 0.1% → treat as neutral (weak bullish)
        trend = 'neutral';
        strength = 'weak';
      }
    } else if (ema9_4h < ema21_4h) {
      // Bearish: EMA9 below EMA21
      if (ema21Slope < -0.5) {
        trend = 'bearish';
        strength = 'strong';
      } else if (ema21Slope < -0.1) {
        trend = 'bearish';
        strength = 'moderate';
      } else {
        // slope >= -0.1% → treat as neutral (weak bearish)
        trend = 'neutral';
        strength = 'weak';
      }
    }

    console.log(`[Engine] ${symbol} 4H Trend: ${trend} ${strength} (ema9: ${ema9_4h.toFixed(2)}, ema21: ${ema21_4h.toFixed(2)}, slope: ${ema21Slope.toFixed(3)}%)`);

    // Return both new format (for hard filter) and legacy format (for bonus scoring)
    return {
      trend,
      strength,
      ema21Slope,
      // Legacy format for backward compatibility with calcMultiTimeframeScore/boost
      legacyTrend: trend === 'bullish' ? 'BUY' : trend === 'bearish' ? 'SELL' : null
    };
  } catch (err) {
    console.log(`[Engine] ${symbol} 4H Trend error: ${err.message}`);
    return null;
  }
}

/**
 * PHASE 1: Market Awareness Layer
 * Fetch BTCUSDT 4H trend to use as a global filter
 * Bullish: EMA9 > EMA21
 * Bearish: EMA9 < EMA21
 * @returns {Promise<string>} 'BULLISH', 'BEARISH', or 'UNKNOWN'
 */
async function getBTCTrend() {
  try {
    const klines = await getKlines('BTCUSDT', '4h', 50);
    if (!klines || klines.length < 21) {
      console.log('[Market Awareness] BTC Trend: UNKNOWN (Insufficient data)');
      return 'UNKNOWN';
    }

    const closes = klines.map(k => k.close);
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);

    const emaGapPct = Math.abs(ema9 - ema21) / ema21 * 100;
    
    let trend = 'UNKNOWN';
    if (ema9 > ema21) {
      trend = emaGapPct > 0.2 ? 'STRONG_BULLISH' : 'BULLISH';
    } else if (ema9 < ema21) {
      trend = emaGapPct > 0.2 ? 'STRONG_BEARISH' : 'BEARISH';
    }

    console.log(`[Market Awareness] BTC Trend: ${trend} (Gap: ${emaGapPct.toFixed(2)}%)`);
    return trend;
  } catch (err) {
    console.error(`[Market Awareness] BTC Trend error: ${err.message}`);
    return 'UNKNOWN';
  }
}

module.exports = {
  calculate4HEMASlope,
  detect4HTrend,
  getBTCTrend
};
