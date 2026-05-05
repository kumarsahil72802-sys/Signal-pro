const { getKlines, getLivePrice, getTopUsdtSymbols } = require('./binanceService');
const { getTopCoins } = require('./coingeckoService');
const { getExecutionQualityForSymbols } = require('./executionQualityService');
const { getNews } = require('./cryptoCompareService');
const { saveTradeSnapshot } = require('./tradeService');
const Signal = require('../models/Signal');
const SystemConfig = require('../models/SystemConfig');
const { enhancedAnalyze } = require('./aiAnalyst');
const { askGroq } = require('./groqService');

// ============================================================================
// CONFIGURATION
// ============================================================================
const COIN_SELECTOR = (process.env.SIGNAL_COINS || 'TOP50').trim().toUpperCase();
const SIGNAL_TOP_COINS = Math.max(1, Number(process.env.SIGNAL_TOP_COINS || 50));
const SIGNAL_MAX_COINS = Math.max(1, Number(process.env.SIGNAL_MAX_COINS || 120));
const SIGNAL_MIN_24H_QUOTE_VOLUME_USDT = Math.max(0, Number(process.env.SIGNAL_MIN_24H_QUOTE_VOLUME_USDT || 2000000));
const SIGNAL_USE_EXECUTION_QUALITY = String(process.env.SIGNAL_USE_EXECUTION_QUALITY || 'true').trim().toLowerCase() !== 'false';
const COIN_LIST_REFRESH_MS = 15 * 60 * 1000; // 15 minutes
const TRADABLE_SYMBOL_CACHE_MS = 15 * 60 * 1000; // 15 minutes
const TRADABLE_SYMBOL_FETCH_LIMIT = 1500;
const INTERVAL = process.env.SIGNAL_INTERVAL || '1h';
const CANDLE_COUNT = 100;      // 100 candles for accurate RSI/MACD calculation
const TREND_CANDLES = 22;     // Need 22 for EMA 21 + previous
const CHECK_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes

// Quality thresholds (dynamic - auto-learning adjusts these)
const CONFIDENCE_THRESHOLD_KEY = 'confidence_threshold';
const DEFAULT_MIN_CONFIDENCE = 60;

// Local cache for threshold (DB-backed, persisted across restarts)
let cachedMinConfidence = DEFAULT_MIN_CONFIDENCE;

const MIN_MOMENTUM_PCT = 0.7;     // Minimum 0.7% price movement required
const ANALYSIS_WINDOW_SIZE = 50;  // Analyze last 50 closed signals
const LEARNING_CHECK_INTERVAL_MS = 60 * 60 * 1000;  // Check every hour

// Threshold bounds (prevent extreme values)
const MIN_CONFIDENCE_FLOOR = 55;   // Never go below 55
const MIN_CONFIDENCE_CEILING = 80; // Never go above 80

// Cooldown: 2 hour block after signal generation
const COOLDOWN_MS = 2 * 60 * 60 * 1000;

// Track last signal time per coin (in-memory cooldown tracking)
const lastSignalTimes = new Map();

// Track last learning analysis time
let lastLearningCheck = 0;

// Engine status for health monitoring
let engineRunning = false;
let engineStartTime = null;
let engineTickInProgress = false;
let cachedResolvedCoins = [];
let cachedCoinListUntil = 0;
let cachedTradableSymbols = new Set();
let cachedTradableSymbolsUntil = 0;

const STABLE_BASE_ASSETS = new Set([
  'USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'PYUSD'
]);

function parseTopSelector(selector) {
  const match = selector.match(/^TOP(\d{1,3})$/);
  if (!match) return null;
  return Number(match[1]);
}

function normalizeCoinToken(token) {
  const normalized = token.trim().toUpperCase();
  if (!normalized) return null;
  if (/^[A-Z0-9]+USDT$/.test(normalized)) return normalized;
  if (/^[A-Z0-9]+$/.test(normalized)) return `${normalized}USDT`;
  return null;
}

function dedupeCoins(coins) {
  return [...new Set(coins)];
}

function filterStableBasePairs(coins) {
  return coins.filter((symbol) => {
    const base = symbol.replace(/USDT$/, '');
    return !STABLE_BASE_ASSETS.has(base);
  });
}

async function getTradableUsdtSymbolSet() {
  const now = Date.now();
  if (now < cachedTradableSymbolsUntil && cachedTradableSymbols.size > 0) {
    return cachedTradableSymbols;
  }

  const tradableSymbols = await getTopUsdtSymbols({
    limit: TRADABLE_SYMBOL_FETCH_LIMIT,
    minQuoteVolume: 0,
    excludeStableBases: true
  });

  cachedTradableSymbols = new Set(tradableSymbols);
  cachedTradableSymbolsUntil = now + TRADABLE_SYMBOL_CACHE_MS;
  return cachedTradableSymbols;
}

async function resolveCoins(topCoins = []) {
  const now = Date.now();
  if (now < cachedCoinListUntil && cachedResolvedCoins.length > 0) {
    return cachedResolvedCoins;
  }

  let coins = [];

  if (COIN_SELECTOR === 'ALL') {
    coins = await getTopUsdtSymbols({
      limit: SIGNAL_MAX_COINS,
      minQuoteVolume: SIGNAL_MIN_24H_QUOTE_VOLUME_USDT,
      excludeStableBases: true
    });
  } else {
    const topCount = parseTopSelector(COIN_SELECTOR);
    if (topCount) {
      const requestedCount = Math.min(topCount, SIGNAL_MAX_COINS);
      const sourceTopCoins = topCoins.length > 0
        ? topCoins
        : await getTopCoins(Math.max(SIGNAL_TOP_COINS, requestedCount));

      coins = sourceTopCoins
        .map((coin) => normalizeCoinToken(String(coin.symbol || '')))
        .filter(Boolean)
        .slice(0, requestedCount);
    } else {
      coins = COIN_SELECTOR
        .split(',')
        .map(normalizeCoinToken)
        .filter(Boolean);
    }
  }

  coins = filterStableBasePairs(dedupeCoins(coins)).slice(0, SIGNAL_MAX_COINS);

  try {
    const tradableSet = await getTradableUsdtSymbolSet();
    const beforeCount = coins.length;
    coins = coins.filter((symbol) => tradableSet.has(symbol));
    const removedCount = beforeCount - coins.length;
    if (removedCount > 0) {
      console.log(`[ENGINE] Filtered out ${removedCount} non-tradable Binance pairs.`);
    }
  } catch (error) {
    console.log(`[ENGINE] Tradable symbol validation skipped: ${error.message}`);
  }

  if (coins.length === 0) {
    coins = ['BTCUSDT'];
    console.log('[ENGINE] Coin resolution returned empty list, falling back to BTCUSDT.');
  }

  cachedResolvedCoins = coins;
  cachedCoinListUntil = now + COIN_LIST_REFRESH_MS;
  return coins;
}

// ============================================================================
// THRESHOLD PERSISTENCE FUNCTIONS
// ============================================================================

/**
 * Load confidence threshold from database
 * Falls back to default if DB unavailable
 */
async function loadThresholdFromDB() {
  try {
    const storedValue = await SystemConfig.getValue(CONFIDENCE_THRESHOLD_KEY);
    if (storedValue !== null && typeof storedValue === 'number') {
      cachedMinConfidence = storedValue;
      console.log(`[Config] Loaded confidence threshold from DB: ${cachedMinConfidence}`);
    } else {
      // Initialize with default
      await SystemConfig.setValue(CONFIDENCE_THRESHOLD_KEY, DEFAULT_MIN_CONFIDENCE);
      cachedMinConfidence = DEFAULT_MIN_CONFIDENCE;
      console.log(`[Config] Initialized confidence threshold: ${DEFAULT_MIN_CONFIDENCE}`);
    }
  } catch (error) {
    console.error(`[Config] Failed to load threshold from DB: ${error.message}`);
    console.log(`[Config] Using fallback threshold: ${cachedMinConfidence}`);
  }
}

/**
 * Save confidence threshold to database
 * Silently fails if DB unavailable (local cache still updated)
 */
async function saveThresholdToDB(value) {
  try {
    await SystemConfig.setValue(CONFIDENCE_THRESHOLD_KEY, value);
    return true;
  } catch (error) {
    console.error(`[Config] Failed to save threshold to DB: ${error.message}`);
    return false;
  }
}

/**
 * Get current confidence threshold (from local cache)
 */
function getConfidenceThreshold() {
  return cachedMinConfidence;
}

/**
 * Update confidence threshold (local + DB)
 */
async function updateConfidenceThreshold(newValue) {
  cachedMinConfidence = newValue;
  await saveThresholdToDB(newValue);
}

// Coin symbol to name mapping for news filtering
const COIN_NAME_MAP = {
  'BTC': 'Bitcoin',
  'ETH': 'Ethereum',
  'BNB': 'BNB',
  'SOL': 'Solana',
  'ADA': 'Cardano',
  'XRP': 'Ripple',
  'DOT': 'Polkadot',
  'DOGE': 'Dogecoin',
  'AVAX': 'Avalanche',
  'LINK': 'Chainlink'
};

const BULLISH_NEWS_KEYWORDS = [
  'breakout', 'surge', 'rally', 'buy', 'bullish', 'pump', 'partnership', 'launch', 'adoption'
];

const BEARISH_NEWS_KEYWORDS = [
  'crash', 'dump', 'bearish', 'sell', 'hack', 'ban', 'lawsuit', 'fear', 'drop', 'scam'
];

function countKeywordHits(text, keywords) {
  return keywords.reduce((count, keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.match(new RegExp(`\\b${escaped}\\b`, 'g'));
    return count + (matches ? matches.length : 0);
  }, 0);
}

/**
 * Calculate simple news sentiment score for a symbol.
 * Returns a normalized score from -1.0 (very bearish) to +1.0 (very bullish).
 * On fetch errors or empty data, returns 0 silently.
 */
async function calcNewsSentiment(symbol) {
  try {
    const baseSymbol = symbol.replace('USDT', '');
    const articles = await getNews(baseSymbol, 5);
    if (!articles || articles.length === 0) return 0;
    const headlines = articles.map(a => a.title).filter(Boolean).slice(0, 5).join('\n');
    const prompt = `Crypto sentiment analyzer. Headlines for ${baseSymbol}:\n${headlines}\n\nReply ONLY with a number -1.0 to 1.0. No explanation.`;
    const result = await askGroq(prompt, '0');
    const score = parseFloat(result);
    return isNaN(score) ? 0 : Math.max(-1, Math.min(1, score));
  } catch (e) { return 0; }
}

/**
 * Calculate Simple Moving Average (SMA)
 * @param {number[]} closes - Array of closing prices
 * @returns {number} SMA value
 */
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
  const PROXIMITY_THRESHOLD = 0.3; // 0.3% threshold

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
  if (slope > 0.05) {
    // Check EMA21 test (price pulled back to EMA21)
    const testingEma21 = currentPrice <= ema21 && Math.abs(currentPrice - ema21) / currentPrice * 100 <= 0.3;
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
      if (rejection) {
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
  if (slope < -0.05) {
    // Check EMA21 test (price pulled back to EMA21)
    const testingEma21 = currentPrice >= ema21 && Math.abs(currentPrice - ema21) / currentPrice * 100 <= 0.3;
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
      if (rejection) {
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

/**
 * PHASE 1: Market Regime Discovery
 * Determines if market is in a TRENDING, CONSOLIDATING, or RANGING state.
 * Only truly dead markets are marked RANGING.
 * 
 * @param {number[]} closes - Array of closing prices
 * @param {number} ema9 - Current EMA9
 * @param {number} ema21 - Current EMA21
 * @param {number} slope - Current EMA21 slope
 * @returns {string} 'TRENDING' | 'CONSOLIDATING' | 'RANGING'
 */
function detectMarketRegime(closes, ema9, ema21, slope) {
  const absSlope = Math.abs(slope);
  const bb = calculateBollingerBands(closes);
  
  // RANGING Condition: 
  // 1. Very flat slope (< 0.05%) AND 
  // 2. Narrow bandwidth (< 1.5%) = Low volatility stagnation
  if (absSlope < 0.05 && bb.bandwidth < 1.5) {
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

/**
 * Calculate momentum (price change percentage) over the period
 * @param {number[]} closes - Array of closing prices
 * @returns {number} Momentum percentage
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

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Calculate RSI score (0-15)
 * - RSI 45-55 → 15 (ideal)
 * - RSI 35-45 or 55-65 → 10
 * - RSI outside → 5
 * @param {number} rsi - RSI value
 * @returns {number} RSI score
 */
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
 * - Volume Delta bonus/penalty: Now included in volume scoring
 *
 * Total max: 125 → normalized to 100
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
  const volumeSpikeResult = calcVolumeSpikeBonus(volumeData, volumeDelta, trend);
  const volumeSpikeBonus = volumeSpikeResult.bonus;
  const volumeSpikePenalty = volumeSpikeResult.penalty;
  const trendStrengthBonus = calcTrendStrengthBonus(advancedSignal, currentPrice);

  // NEW: Add EMA slope bonus and crossover confirmation bonus (v2)
  const emaSlopeBonus = calcEMASlopeBonus(advancedSignal?.slope || 0);
  const crossoverBonus = calcCrossoverConfirmationBonus(advancedSignal);

  const rawScore = rsiScore + macdScore + trendScore + volumeScore + bbScore + mtScore + momentumBonus + volumeSpikeBonus + trendStrengthBonus + emaSlopeBonus + crossoverBonus + volumeSpikePenalty;
  const maxRawScore = 125; // 85 + 10 (momentum) + 10 (volume spike) + 10 (trend strength) + 5 (EMA slope) + 15 (crossover)

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
function calcRSIExtremePenalty(rsi) {
  if (rsi < 30 || rsi > 70) return -10;
  return 0;
}

/**
 * Calculate penalty for weak volume
 * @param {Object} volumeData - Volume check result
 * @returns {number} Penalty score (negative)
 */
function calcWeakVolumePenalty(volumeData) {
  if (!volumeData || volumeData.isBelowAvg) return -5;
  return 0;
}

/**
 * Calculate penalty for flat momentum
 * @param {number} momentum - Momentum percentage
 * @returns {number} Penalty score (negative)
 */
function calcFlatMomentumPenalty(momentum) {
  if (Math.abs(momentum) < 0.3) return -10;
  return 0;
}

/**
 * Calculate penalty for opposite short-term vs long-term momentum
 * @param {number} shortTermMomentum - Short-term momentum
 * @param {number} midTermMomentum - Mid-term momentum
 * @returns {number} Penalty score (negative)
 */
function calcMomentumConflictPenalty(shortTermMomentum, midTermMomentum) {
  if ((shortTermMomentum > 0 && midTermMomentum < 0) || (shortTermMomentum < 0 && midTermMomentum > 0)) {
    return -10;
  }
  return 0;
}

/**
 * Calculate total confidence penalty
 * @param {Object} params - All indicator data
 * @returns {number} Total penalty score (negative)
 */
function calcConfidencePenalty(params) {
  const { rsi, volumeData, momentum, shortTermMomentum, midTermMomentum } = params;
  const rsiPenalty = calcRSIExtremePenalty(rsi);
  const volumePenalty = calcWeakVolumePenalty(volumeData);
  const momentumPenalty = calcFlatMomentumPenalty(momentum);
  const conflictPenalty = calcMomentumConflictPenalty(shortTermMomentum, midTermMomentum);
  return rsiPenalty + volumePenalty + momentumPenalty + conflictPenalty;
}

/**
 * Calculate market score based on 24h price change (max 30 points)
 * @param {string} coin - Coin symbol (e.g., BTCUSDT)
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {number} Market score (0-30)
 */
async function calcMarketScore(coin, trend, topCoins) {
  try {
    if (!topCoins) {
      topCoins = await getTopCoins(50);
    }
    const symbol = coin.replace('USDT', '').toLowerCase();
    const coinData = topCoins.find(c => c.symbol === symbol);

    if (!coinData || coinData.price_change_percentage_24h == null) return 15;

    const change24h = coinData.price_change_percentage_24h;

    if (trend === 'BUY' && change24h > 0) return Math.min(30, Math.round(change24h * 3));
    if (trend === 'SELL' && change24h < 0) return Math.min(30, Math.round(Math.abs(change24h) * 3));
    if (trend === 'BUY' && change24h < 0) return Math.max(0, Math.round(15 + change24h * 2));
    if (trend === 'SELL' && change24h > 0) return Math.max(0, Math.round(15 - change24h * 2));

    return 15;
  } catch {
    return 15;
  }
}

// ============================================================================
// SIGNAL BUILDING
// ============================================================================

/**
 * Build signal data with ATR-based target and stop loss
 * BUY: target = entry + ATR*1.5, stopLoss = entry - ATR*1
 * SELL: target = entry - ATR*1.5, stopLoss = entry + ATR*1
 * Risk:Reward = 1:1.5
 * @param {string} coin - Coin symbol
 * @param {string} type - 'BUY' or 'SELL'
 * @param {number} entryPrice - Entry price
 * @param {number} atr - ATR value for volatility-based levels
 * @returns {Object} Signal data object
 */
function buildSignalData(coin, type, entryPrice, atr) {
  if (!atr || atr <= 0) {
    atr = entryPrice * 0.007;  // Fallback to ~0.7% if ATR unavailable
  }

  const targetOffset = atr * 1.5;
  const stopOffset = atr * 1;

  if (type === 'BUY') {
    return {
      coin,
      type,
      entryPrice,
      target: +(entryPrice + targetOffset).toFixed(2),
      stopLoss: +(entryPrice - stopOffset).toFixed(2),
      atr: +atr.toFixed(2),
      strength: 70
    };
  }

  return {
    coin,
    type,
    entryPrice,
    target: +(entryPrice - targetOffset).toFixed(2),
    stopLoss: +(entryPrice + stopOffset).toFixed(2),
    atr: +atr.toFixed(2),
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
 * Only rejects if confidence < 50 (no data/API failures handled separately)
 */
function runQualityFilters(confidence, volumeData, momentum) {
  // Minimum confidence threshold for any signal
  if (confidence < 50) {
    return { passed: false, reason: 'Confidence below minimum (50)' };
  }

  // Dynamic threshold check for higher quality signals
  if (confidence < getConfidenceThreshold()) {
    return { passed: false, reason: 'Below dynamic threshold' };
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
  const hardBlockFloor = Math.max(getConfidenceThreshold() + 5, 70);
  const shouldBlock = riskyExecution && highSlippage && adjustedConfidence < hardBlockFloor;

  return {
    adjustedConfidence,
    adjustment,
    shouldBlock,
    reason: `execution:${executionQuality || 'UNKNOWN'} slippage:${slippageRisk || 'UNKNOWN'}`
  };
}

async function generateSignalForCoin(coin, topCoins = null, btcTrend = 'UNKNOWN') {
  // Check 1: Active signal exists (duplicate protection)
  const activeSignal = await Signal.findOne({ coin, status: 'ACTIVE' });
  if (activeSignal) {
    console.log(`[ENGINE] ${coin} skipped → Active signal exists`);
    return null;
  }

  // Check 2: DB-based cooldown - prevent duplicate within 2 hours
  const recentSignal = await Signal.findOne({
    coin,
    createdAt: { $gte: new Date(Date.now() - COOLDOWN_MS) }
  }).sort({ createdAt: -1 });

  if (recentSignal) {
    const elapsed = Date.now() - recentSignal.createdAt.getTime();
    const remaining = COOLDOWN_MS - elapsed;
    const mins = Math.ceil(remaining / 60000);
    console.log(`[ENGINE] ${coin} skipped → Recent signal exists (${mins}m ago)`);
    return null;
  }

  // Check 3: In-memory cooldown period (backup)
  const lastTime = lastSignalTimes.get(coin);
  if (lastTime) {
    const elapsed = Date.now() - lastTime;
    const remaining = COOLDOWN_MS - elapsed;
    if (remaining > 0) {
      const mins = Math.ceil(remaining / 60000);
      console.log(`[ENGINE] ${coin} skipped → Cooldown (${mins}m remaining)`);
      return null;
    }
  }

  // Fetch candle data
  let klines;
  try {
    klines = await getKlines(coin, INTERVAL, CANDLE_COUNT);
  } catch (err) {
    console.error(`[Engine] ${coin} error → Failed to fetch klines: ${err.message}`);
    return null;
  }

  if (!klines || klines.length < TREND_CANDLES) {
    console.log(`[Engine] ${coin} skipped → Insufficient data`);
    return null;
  }

  // Extract price data
  const allCloses = klines.map(k => k.close);
  const trendCloses = allCloses.slice(-TREND_CANDLES);
  const currentPrice = trendCloses[trendCloses.length - 1];

  // Volume check
  const volumeData = checkVolume(klines);

  // Volume Delta analysis - analyzes buying vs selling pressure
  const volumeDelta = calculateVolumeDelta(klines);

  // --- M2C2 Phase 1: Market Regime Discovery ---
  const regEma9 = calculateEMA(trendCloses, 9);
  const regEma21 = calculateEMA(trendCloses, 21);
  const regSlope = calculateEMASlope(trendCloses);
  const regime = detectMarketRegime(allCloses, regEma9, regEma21, regSlope);

  // Block only dead-flat markets; allow TRENDING and CONSOLIDATING to continue.
  if (regime === 'RANGING') {
    console.log(`[ENGINE] ${coin} skipped → Market Regime is RANGING (M2C2 Phase 1 Filter)`);
    return null;
  }
  // ----------------------------------------------

  // NEW v3: Volatility Breakout Engine (Bollinger Band Squeeze)
  // Catch moves BEFORE they even start testing EMAs
  const breakoutSignal = detectVolatilityBreakout(klines);
  
  // Use breakout signal if found, otherwise fallback to advanced EMA-based detection
  const advancedSignal = breakoutSignal || detectAdvancedSignal(trendCloses, klines);

  if (!advancedSignal) {
    console.log(`[Engine] ${coin} skipped → No valid trigger (Flat market)`);
    return null;
  }
  const { trend, trigger, slope, reason } = advancedSignal;
  // Log the trigger type for debugging
  console.log(`[Engine] ${coin} Trigger: ${trigger} | Slope: ${slope.toFixed(2)}% | ${reason}`);

  // PHASE 1: Market Awareness Layer (BTC Trend Filter)
  let btcConfidencePenalty = 0;

  // Strict Filter: Block BUY signals if BTC is strongly bearish
  if (btcTrend === 'STRONG_BEARISH' && trend === 'BUY') {
    console.log(`[Engine] ${coin} BUY signal BLOCKED by BTC Strong Bearish trend`);
    return null;
  }

  // Soft Filter: Apply penalty if BTC is bullish but we want to SELL
  if (btcTrend.includes('BULLISH') && trend === 'SELL') {
    btcConfidencePenalty = -20;
    console.log(`[Engine] ${coin} SELL signal penalized (-20) by BTC Bullish trend`);
  }

  // Soft Filter: Apply penalty if BTC is bearish (but not strong) and we want to BUY
  if (btcTrend === 'BEARISH' && trend === 'BUY') {
    btcConfidencePenalty = -15;
    console.log(`[Engine] ${coin} BUY signal penalized (-15) by BTC Bearish trend`);
  }

  // Momentum calculation
  const momentum = calculateMomentum(trendCloses);

  // Short-term and mid-term momentum for minimum strength conditions
  const shortTermMomentum = calculateShortTermMomentum(allCloses);
  const midTermMomentum = calculateMidTermMomentum(allCloses);

  // RSI calculation - no longer a hard filter
  const rsiCloses = allCloses.slice(-15);
  const rsi = calculateRSI(rsiCloses);

  // PREPARE FOR AI LAYER: Calculate previous RSI
  const prevRsiCloses = allCloses.slice(-16, -1);
  const prevRsi = calculateRSI(prevRsiCloses);


  // RSI history for momentum boost calculation
  const rsiHistory = [];
  for (let i = 3; i <= 10; i += 3) {
    const histCloses = allCloses.slice(-15 - i, -i);
    if (histCloses.length >= 14) {
      rsiHistory.push(calculateRSI(histCloses));
    }
  }

  // MACD calculation - no longer a hard filter
  const macdData = calculateMACD(allCloses);

  // Bollinger Bands calculation - no longer a hard filter
  const bbData = calculateBollingerBands(allCloses, 20);
  let bbWidthPercent = 0;
  let bbExpanding = false;
  if (bbData) {
    bbWidthPercent = (bbData.upper - bbData.lower) / bbData.middle * 100;
    
    const prevBbData = calculateBollingerBands(allCloses.slice(0, -1), 20);
    if (prevBbData) {
      bbExpanding = bbData.bandwidth > prevBbData.bandwidth;
    }
  }

  // 4H higher timeframe trend - no longer a hard filter
  const higherTimeframeTrend = await detect4HTrend(coin);
  // Use legacyTrend for bonus scoring (backward compatibility), trend for hard filter
  const higherTrend = higherTimeframeTrend ? higherTimeframeTrend.legacyTrend : null;

  // Calculate all scores using new scoring system (v2 with advanced signal + Volume Delta)
  const technicalScore = calcTechnicalScore({
    advancedSignal,
    momentum,
    volumeData,
    volumeDelta,
    rsi,
    macdData,
    bbWidthPercent,
    bbExpanding,
    higherTrend,
    shortTermMomentum,
    midTermMomentum,
    currentPrice
  });

  // Fetch market score
  const marketScore = await calcMarketScore(coin, trend, topCoins).catch(err => {
    console.log(`[Engine] ${coin}: Market score failed, using fallback - ${err.message}`);
    return 15; // Fallback neutral market score
  });

  // Final confidence: Technical (70%) + Market (30%)
  const normalizedMarketScore = Math.round((marketScore / 30) * 30);
  const baseConfidence = Math.round(technicalScore * 0.7 + normalizedMarketScore * 0.3);

  // Calculate confidence boost and penalty
  const confidenceBoost = calcConfidenceBoost({
    trendData: advancedSignal,
    higherTrend,
    macdData,
    rsi,
    rsiHistory,
    bbExpanding,
    currentPrice
  });

  const confidencePenalty = calcConfidencePenalty({
    rsi,
    volumeData,
    momentum,
    shortTermMomentum,
    midTermMomentum
  });

  // Volume Delta direction penalty: penalize if volume confirms opposite direction
  // BUY signal + sellDominant → -8 penalty
  // SELL signal + buyDominant → -8 penalty
  let volumeDeltaPenalty = 0;
  if (trend === 'BUY' && volumeDelta.sellDominant) {
    volumeDeltaPenalty = -8;
  } else if (trend === 'SELL' && volumeDelta.buyDominant) {
    volumeDeltaPenalty = -8;
  }

  if (hasStrongIndicatorConflict({
    trend,
    macdData,
    currentPrice,
    shortTermMomentum,
    midTermMomentum,
    volumeDelta
  })) {
    console.log(`[ENGINE] ${coin} BLOCKED -> Strong indicator conflict (MACD + momentum + volume against ${trend})`);
    return null;
  }

  // Apply weak indicator penalty (reduce confidence, don't reject)
  const indicatorStrengths = {
    rsi: getRSIStrengthLevel(rsi),
    macd: getMACDStrengthLevel(macdData, trend, currentPrice),
    momentum: getMomentumStrengthLevel(shortTermMomentum, midTermMomentum, trend),
    volume: getVolumeStrengthLevel(volumeData),
    trend: getTrendStrengthLevel(advancedSignal, currentPrice)
  };
  const weakPenalty = calcWeakIndicatorPenalty(indicatorStrengths);

  // Calculate final confidence with all adjustments
  let confidence = Math.max(0, Math.min(100, baseConfidence + confidenceBoost + confidencePenalty + weakPenalty + volumeDeltaPenalty + btcConfidencePenalty));
  const sentimentScore = await calcNewsSentiment(coin);
  let sentimentConfidenceAdjustment = 0;
  if (sentimentScore > 0.3) {
    sentimentConfidenceAdjustment = 3;
  } else if (sentimentScore < -0.3) {
    sentimentConfidenceAdjustment = -3;
  }
  confidence = Math.max(0, Math.min(100, confidence + sentimentConfidenceAdjustment));

  // Determine signal quality level
  let fourHPenalty = 0;
  let executionAdjustment = 0;
  let executionQualityData = null;
  let signalQuality = getSignalQuality(confidence);
  if (!signalQuality) {
    console.log(`[Engine] ${coin} skipped → Confidence below minimum (${confidence}%)`);
    return null;
  }

  // Run quality filters before saving (only confidence threshold check)
  let qualityCheck = runQualityFilters(confidence, volumeData, momentum);
  if (!qualityCheck.passed) {
    console.log(`[Engine] ${coin} skipped → ${qualityCheck.reason} (confidence: ${confidence}%)`);
    return null;
  }

  // ============================================================================
  // 4H HARD FILTER - Block signals when higher timeframe opposes signal direction
  // ============================================================================
  // If 4H data unavailable, fail open (continue normally) - per requirements
  if (higherTimeframeTrend) {
    const fourHTrend = higherTimeframeTrend.trend;
    const fourHStrength = higherTimeframeTrend.strength;
    const fourHSlope = higherTimeframeTrend.ema21Slope;

    // FOR BUY SIGNALS: Block if 4H is bearish
    if (trend === 'BUY') {
      if (fourHTrend === 'bearish' && fourHStrength === 'strong') {
        // BLOCK: Strong bearish 4H opposes BUY
        console.log(`[ENGINE] ${coin} BLOCKED → Signal blocked: 4H strong bearish trend opposes 1H BUY | 4H:${fourHTrend} ${fourHStrength} slope:${fourHSlope.toFixed(3)}%`);
        return null;
      }
      if (fourHTrend === 'bearish' && fourHStrength === 'moderate') {
        // BLOCK: Moderate bearish 4H opposes BUY
        console.log(`[ENGINE] ${coin} BLOCKED → Signal blocked: 4H moderate bearish trend opposes 1H BUY | 4H:${fourHTrend} ${fourHStrength} slope:${fourHSlope.toFixed(3)}%`);
        return null;
      }
      if (fourHTrend === 'bearish' && fourHStrength === 'weak') {
        // DO NOT BLOCK: Weak bearish - apply -15 confidence penalty instead
        console.log(`[ENGINE] ${coin} 4H FILTER → Weak bearish 4H detected, applying -15 penalty | 4H:${fourHTrend} ${fourHStrength} slope:${fourHSlope.toFixed(3)}%`);
        fourHPenalty = -15;
        confidence = Math.max(0, confidence + fourHPenalty);
      }
      // If 4H is bullish or neutral: DO NOT block, keep existing bonus (no change)
    }

    // FOR SELL SIGNALS: Block if 4H is bullish
    if (trend === 'SELL') {
      if (fourHTrend === 'bullish' && fourHStrength === 'strong') {
        // BLOCK: Strong bullish 4H opposes SELL
        console.log(`[ENGINE] ${coin} BLOCKED → Signal blocked: 4H strong bullish trend opposes 1H SELL | 4H:${fourHTrend} ${fourHStrength} slope:${fourHSlope.toFixed(3)}%`);
        return null;
      }
      if (fourHTrend === 'bullish' && fourHStrength === 'moderate') {
        // BLOCK: Moderate bullish 4H opposes SELL
        console.log(`[ENGINE] ${coin} BLOCKED → Signal blocked: 4H moderate bullish trend opposes 1H SELL | 4H:${fourHTrend} ${fourHStrength} slope:${fourHSlope.toFixed(3)}%`);
        return null;
      }
      if (fourHTrend === 'bullish' && fourHStrength === 'weak') {
        // DO NOT BLOCK: Weak bullish - apply -15 confidence penalty instead
        console.log(`[ENGINE] ${coin} 4H FILTER → Weak bullish 4H detected, applying -15 penalty | 4H:${fourHTrend} ${fourHStrength} slope:${fourHSlope.toFixed(3)}%`);
        fourHPenalty = -15;
        confidence = Math.max(0, confidence + fourHPenalty);
      }
      // If 4H is bearish or neutral: DO NOT block, keep existing bonus (no change)
    }
  } else {
    // 4H data unavailable - fail open (continue normally)
    console.log(`[Engine] 4H data unavailable for ${coin}, skipping hard filter`);
  }

  // Execution quality integration (spread + slippage + liquidity)
  if (SIGNAL_USE_EXECUTION_QUALITY) {
    try {
      const qualityMap = await getExecutionQualityForSymbols([coin]);
      executionQualityData = qualityMap?.[coin] || null;
    } catch (error) {
      console.log(`[Engine] ${coin} execution quality fetch failed (fail-open): ${error.message}`);
    }

    const executionDecision = applyExecutionQualityAdjustment(confidence, executionQualityData);
    confidence = executionDecision.adjustedConfidence;
    executionAdjustment = executionDecision.adjustment;

    if (executionDecision.shouldBlock) {
      console.log(`[ENGINE] ${coin} BLOCKED â†’ Illiquid execution conditions (${executionDecision.reason}) | confidence:${confidence}%`);
      return null;
    }
  }

  // Final quality gate after all confidence adjustments
  signalQuality = getSignalQuality(confidence);
  if (!signalQuality) {
    console.log(`[Engine] ${coin} skipped â†’ Final confidence below minimum (${confidence}%)`);
    return null;
  }

  qualityCheck = runQualityFilters(confidence, volumeData, momentum);
  if (!qualityCheck.passed) {
    console.log(`[Engine] ${coin} skipped â†’ Final ${qualityCheck.reason} (confidence: ${confidence}%)`);
    return null;
  }

  // Build signal reasons
  const reasons = getReasonLabels(advancedSignal, momentum, volumeData, rsi);

  // Calculate ATR for volatility-based target/stop loss
  const atr = calculateATR(klines, 14);

  // Build signal data
  const signalData = buildSignalData(coin, trend, currentPrice, atr);
  signalData.confidence = confidence;
  signalData.sentimentScore = sentimentScore;
  signalData.signalQuality = signalQuality;
  signalData.confidenceBreakdown = {
    technical: Math.round(technicalScore * 0.7),
    market: normalizedMarketScore,
    sentiment: sentimentScore,
    bonus: confidenceBoost + (sentimentConfidenceAdjustment > 0 ? sentimentConfidenceAdjustment : 0),
    penalty: confidencePenalty + weakPenalty + volumeDeltaPenalty + btcConfidencePenalty + fourHPenalty + executionAdjustment + (sentimentConfidenceAdjustment < 0 ? sentimentConfidenceAdjustment : 0)
  };
  // Add rsi and macd to reason
  reasons.rsi = rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi > 55 ? 'BULLISH' : rsi < 45 ? 'BEARISH' : 'NEUTRAL';
  reasons.macd = macdData && macdData.histogram > 0 ? 'BULLISH' : macdData && macdData.histogram < 0 ? 'BEARISH' : 'NEUTRAL';
  // Add volume delta info to reason
  reasons.deltaRatio = volumeDelta.deltaRatio.toFixed(2);
  reasons.volumeConfirmed = volumeDelta.buyDominant ? 'BUY_DOMINANT' : volumeDelta.sellDominant ? 'SELL_DOMINANT' : 'NEUTRAL';
  reasons.execution = executionQualityData?.executionQuality || 'UNKNOWN';
  reasons.slippageRisk = executionQualityData?.slippageRisk || 'UNKNOWN';
  signalData.reason = reasons;
  signalData.trigger = trigger;
  signalData.regime = regime;
  signalData.higherTimeframeTrend = higherTimeframeTrend ? higherTimeframeTrend.trend : null;

  const reasonStr = Object.entries(reasons)
    .filter(([k]) => k !== 'rsiValue')
    .map(([k, v]) => `${k}:${v}`)
    .join(' | ');

  // Volume delta confirmation status for logging
  const volumeConfirmed = volumeDelta.buyDominant ? 'BUY_DOMINANT' : volumeDelta.sellDominant ? 'SELL_DOMINANT' : 'NEUTRAL';

  console.log(`[ENGINE] ${coin} SIGNAL CANDIDATE → Trigger:${trigger} | Quality:${signalQuality} | Confidence:${confidence}% | ${trend} | Price:${currentPrice} | ATR:${atr.toFixed(2)} | Target:${signalData.target} | SL:${signalData.stopLoss} | deltaRatio:${volumeDelta.deltaRatio.toFixed(2)} | volumeConfirmed:${volumeConfirmed} | ${reasonStr}`);

  // STEP 3: APPLY AI ADJUSTMENT LAYER (Enhanced with Learning)
  // We decorate the signal object with extra context needed for AI logic
  const signalToAdjust = {
    ...signalData,
    rsi,
    prevRsi,
    volumeSpike: volumeData.isSpike,
    btcTrend,
    trendStrength: signalQuality,
    isLateEntry: false
  };

  const adjustedSignal = await enhancedAnalyze(signalToAdjust);
  if (!adjustedSignal) {
    return null;
  }

  if (adjustedSignal.aiDecision === 'REJECT') {
    console.log(`[ENGINE] ${coin} BLOCKED → AI Learning rejected signal (score:${adjustedSignal.aiScore})`);
    return null;
  }

  signalData.aiScore = adjustedSignal.aiScore;
  signalData.aiDecision = adjustedSignal.aiDecision;
  signalData.aiMessage = adjustedSignal.aiMessage;
  signalData.groqInsight = adjustedSignal.groqInsight ?? '';

  const savedSignal = new Signal(signalData);
  await savedSignal.save();

  try {
    await saveTradeSnapshot({
      coin: signalData.coin,
      setup: signalData.trigger,
      rsi: signalData.indicators?.rsi ?? null,
      volumeRatio: signalData.indicators?.volumeRatio ?? null,
      emaSlope: signalData.indicators?.emaSlope ?? null,
      atrPct: signalData.indicators?.atrPct ?? null,
      btcMomentum: signalData.btcTrend ?? null,
      confidence: signalData.confidence,
      aiScore: signalData.aiScore ?? null
    });
  } catch (error) {
    console.error(`[TradeSnapshot] Failed to save snapshot: ${error.message}`);
  }

  try {
    const explanationPrompt = `Explain this crypto signal in 2-3 simple sentences for a beginner - why generated, what to watch, key risk:
Coin: ${savedSignal.coin}, Type: ${savedSignal.type}, Entry: ${savedSignal.entryPrice}, Target: ${savedSignal.target}, Stop Loss: ${savedSignal.stopLoss}, Confidence: ${savedSignal.confidence}%, Trigger: ${savedSignal.trigger}`;
    const explanation = await askGroq(explanationPrompt, '');
    if (explanation) {
      await Signal.findByIdAndUpdate(savedSignal._id, { explanation });
      savedSignal.explanation = explanation;
    }
  } catch (e) { console.error('[Groq] Explanation failed:', e.message); }

  // Record cooldown timestamp
  lastSignalTimes.set(coin, Date.now());

  console.log(`[ENGINE] ${coin} SIGNAL CREATED → id:${savedSignal._id} | trigger:${trigger} | ai:${signalData.aiDecision} (${signalData.aiScore})`);

  return savedSignal;

}

// ============================================================================
// ENGINE RUNNER
// ============================================================================

/**
 * Auto-learning: Analyze recent performance and adjust confidence threshold
 * FIXED: Only count TAKEN signals for win rate calculation
 * - MISSED signals (user didn't take, price hit target) → separate counter, NOT a loss
 * - EXPIRED signals (user didn't take, SL hit or TTL expired) → separate counter, NOT a loss
 * - winRate < 50% → tighten rules (increase threshold)
 * - winRate > 70% → relax rules (decrease threshold)
 * - Minimum 10 taken signals required before adjusting threshold
 */
async function runAutoLearning() {
  const now = Date.now();

  // Only run every hour
  if (now - lastLearningCheck < LEARNING_CHECK_INTERVAL_MS) {
    return;
  }
  lastLearningCheck = now;

  try {
    // Get total count of all signals ever generated (for rate calculations)
    const totalGenerated = await Signal.countDocuments();

    // Get TAKEN signals that are CLOSED (user took these, result is known)
    // FIXED: Use wasTaken flag to only include signals user actually took
    // This is the ONLY set that should count toward win rate
    const takenSignals = await Signal.find({
      status: 'CLOSED',
      wasTaken: true,  // Only signals user actually took
      result: { $in: ['TARGET_HIT', 'SL_HIT'] }
    })
      .sort({ closedAt: -1 })
      .limit(ANALYSIS_WINDOW_SIZE);

    // Count MISSED opportunities (user didn't take, target hit)
    const missedOpportunities = await Signal.countDocuments({
      status: 'MISSED',
      isMissedOpportunity: true
    });

    // Count EXPIRED: CLOSED signals that were never TAKEN (SL hit without taking)
    // These are CLOSED with wasTaken=false (ACTIVE → CLOSED via SL hit)
    const expiredCount = await Signal.countDocuments({
      status: 'CLOSED',
      wasTaken: false,
      result: 'SL_HIT'
    });

    // Now calculate proper metrics
    // wins = TAKEN + TARGET_HIT
    const wins = takenSignals.filter(s => s.result === 'TARGET_HIT').length;
    const losses = takenSignals.filter(s => s.result === 'SL_HIT').length;
    const takenCount = takenSignals.length;

    // FIXED: Win rate based ONLY on taken signals
    const winRate = takenCount > 0 ? (wins / takenCount) * 100 : 0;

    const oldThreshold = getConfidenceThreshold();
    let newThreshold = oldThreshold;
    let reason = 'no change';

    // FIXED: Only adjust threshold if we have enough taken signals (minimum sample size)
    if (takenCount < 10) {
      console.log(`[LEARNING] Insufficient taken signals (${takenCount}/10), skipping threshold adjustment. ` +
        `Win rate: ${winRate.toFixed(1)}% (based on ${takenCount} taken signals). ` +
        `Missed: ${missedOpportunities}, Expired: ${expiredCount}`);
      return;
    }

    // Adjust threshold based on performance (only using TAKEN signals)
    if (winRate < 50) {
      // Poor performance - tighten rules
      newThreshold = Math.min(MIN_CONFIDENCE_CEILING, oldThreshold + 5);
      reason = 'winRate below 50';
    } else if (winRate > 70) {
      // Good performance - can relax slightly
      newThreshold = Math.max(MIN_CONFIDENCE_FLOOR, oldThreshold - 3);
      reason = 'winRate above 70';
    }

    // Apply new threshold if changed
    if (newThreshold !== oldThreshold) {
      await updateConfidenceThreshold(newThreshold);
      console.log({
        event: 'threshold_adjustment',
        takenSignals: takenCount,
        wins,
        losses,
        winRate: winRate.toFixed(1),
        missedOpportunities,
        expiredSignals: expiredCount,
        oldThreshold,
        newThreshold,
        reason
      });
    } else {
      console.log({
        event: 'threshold_check',
        takenSignals: takenCount,
        wins,
        losses,
        winRate: winRate.toFixed(1),
        missedOpportunities,
        expiredSignals: expiredCount,
        threshold: oldThreshold,
        reason: 'no change needed'
      });
    }
  } catch (error) {
    console.error(`[Learning] Error during analysis: ${error.message}`);
  }
}


async function runEngine() {
  if (engineTickInProgress) {
    console.log('[ENGINE] Previous cycle still running. Skipping overlapping tick.');
    return;
  }

  engineTickInProgress = true;
  try {
    // Run auto-learning before generating signals
    await runAutoLearning();

    console.log(`[ENGINE] Running signal generation (threshold: ${getConfidenceThreshold()})...`);
    let created = 0;

    // Fetch market data once for all coins to avoid rate limiting
    const topSelectorCount = parseTopSelector(COIN_SELECTOR) || 0;
    const marketDataLimit = Math.min(250, Math.max(50, SIGNAL_TOP_COINS, topSelectorCount));
    let topCoins = [];
    try {
      topCoins = await getTopCoins(marketDataLimit);
    } catch (err) {
      console.log(`[ENGINE] Failed to fetch market data: ${err.message}`);
    }

    // Resolve coin universe for this cycle
    let coinsToAnalyze = [];
    try {
      coinsToAnalyze = await resolveCoins(topCoins);
    } catch (err) {
      console.log(`[ENGINE] Failed to resolve coin list: ${err.message}`);
      coinsToAnalyze = ['BTCUSDT'];
    }

    console.log(`[ENGINE] Analyzing ${coinsToAnalyze.length} coin(s). Selector: ${COIN_SELECTOR}`);

    // Fetch global BTC trend once per cycle to avoid redundant API calls
    const btcTrend = await getBTCTrend();

    for (const coin of coinsToAnalyze) {
      try {
        const signal = await generateSignalForCoin(coin, topCoins, btcTrend);
        if (signal) created++;
      } catch (error) {
        console.error(`[ENGINE] ${coin}: Error - ${error.message}`);
      }
    }

    if (created > 0) {
      console.log(`[ENGINE] Done. ${created} signal(s) generated.`);
    } else {
      console.log(`[ENGINE] Done. No signals generated.`);
    }
  } finally {
    engineTickInProgress = false;
  }
}

async function startSignalEngine() {
  // Load persisted threshold from database first
  await loadThresholdFromDB();

  engineRunning = true;
  engineStartTime = new Date();

  runEngine().catch((error) => {
    console.error(`[ENGINE] Initial run failed: ${error.message}`);
  });
  setInterval(() => {
    runEngine().catch((error) => {
      console.error(`[ENGINE] Scheduled run failed: ${error.message}`);
    });
  }, CHECK_INTERVAL_MS);
  console.log(`[ENGINE] Started. Selector:${COIN_SELECTOR} | Interval:${CHECK_INTERVAL_MS / 60000}min | MaxCoins:${SIGNAL_MAX_COINS}`);
}

/**
 * Get engine health status
 */
function getEngineStatus() {
  return engineRunning ? "running" : "stopped";
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  startSignalEngine,
  getEngineStatus,
  getDynamicThreshold: getConfidenceThreshold
};

