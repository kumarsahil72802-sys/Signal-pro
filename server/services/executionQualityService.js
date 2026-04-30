const { getBookTicker, getOrderBook, get24hTicker } = require('./binanceService');

const DEFAULT_DEPTH_LEVELS = 20;
const DEFAULT_ORDER_BOOK_LIMIT = 50;
const DEPTH_FETCH_BATCH_SIZE = 6;
const EXCLUDED_QUALITY_BASES = new Set([
  'USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'PYUSD'
]);

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function isEligibleQualitySymbol(symbol) {
  if (!/^[A-Z0-9]+USDT$/.test(symbol)) return false;
  const base = symbol.slice(0, -4);
  return base.length > 0 && !EXCLUDED_QUALITY_BASES.has(base);
}

function sanitizeSymbols(symbols) {
  if (!Array.isArray(symbols)) return [];
  return [...new Set(symbols.map(normalizeSymbol).filter(isEligibleQualitySymbol))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toRounded(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function getEmptyQuality() {
  return {
    spreadPct: null,
    imbalanceBuyPct: null,
    imbalanceSellPct: null,
    liquidityScore: 0,
    executionQuality: 'RISKY',
    slippageRisk: 'HIGH',
    unavailable: true
  };
}

function calculateSpreadPct(bookTicker) {
  if (!bookTicker) return null;
  const bid = Number(bookTicker.bidPrice);
  const ask = Number(bookTicker.askPrice);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;

  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return ((ask - bid) / mid) * 100;
}

function sumTopDepthNotional(sideLevels, depthLevels) {
  if (!Array.isArray(sideLevels)) return 0;
  return sideLevels
    .slice(0, Math.max(1, depthLevels))
    .reduce((sum, [price, qty]) => sum + (Number(price) * Number(qty)), 0);
}

function calculateOrderbookImbalance(orderBook, depthLevels = DEFAULT_DEPTH_LEVELS) {
  const buyNotional = sumTopDepthNotional(orderBook?.bids, depthLevels);
  const sellNotional = sumTopDepthNotional(orderBook?.asks, depthLevels);
  const total = buyNotional + sellNotional;

  if (!Number.isFinite(total) || total <= 0) {
    return {
      buyPct: null,
      sellPct: null,
      buyNotional: 0,
      sellNotional: 0,
      totalNotional: 0
    };
  }

  return {
    buyPct: (buyNotional / total) * 100,
    sellPct: (sellNotional / total) * 100,
    buyNotional,
    sellNotional,
    totalNotional: total
  };
}

function calculateLiquidityScore(quoteVolume, depthNotional) {
  const safeQuoteVolume = Number(quoteVolume) > 0 ? Number(quoteVolume) : 0;
  const safeDepthNotional = Number(depthNotional) > 0 ? Number(depthNotional) : 0;

  const volumeScore = clamp(((Math.log10(safeQuoteVolume + 1) - 5) / 4) * 100, 0, 100);
  const depthScore = clamp(((Math.log10(safeDepthNotional + 1) - 3) / 3) * 100, 0, 100);

  return Math.round((volumeScore * 0.65) + (depthScore * 0.35));
}

function classifyExecutionQuality(spreadPct, liquidityScore, imbalanceSkew) {
  if (spreadPct == null) return 'RISKY';
  if (spreadPct <= 0.05 && liquidityScore >= 70 && imbalanceSkew <= 40) return 'GOOD';
  if (spreadPct <= 0.15 && liquidityScore >= 40) return 'MODERATE';
  return 'RISKY';
}

function classifySlippageRisk(spreadPct, liquidityScore, depthNotional) {
  if (spreadPct == null) return 'HIGH';
  if (spreadPct <= 0.05 && liquidityScore >= 70 && depthNotional >= 200000) return 'LOW';
  if (spreadPct <= 0.15 && liquidityScore >= 40 && depthNotional >= 50000) return 'MEDIUM';
  return 'HIGH';
}

async function fetchDepthMap(symbols, orderBookLimit) {
  const depthMap = {};
  const queue = [...symbols];

  while (queue.length > 0) {
    const chunk = queue.splice(0, DEPTH_FETCH_BATCH_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (symbol) => {
        const depth = await getOrderBook(symbol, orderBookLimit);
        return [symbol, depth];
      })
    );

    for (const [symbol, depth] of chunkResults) {
      depthMap[symbol] = depth;
    }
  }

  return depthMap;
}

function computeSymbolQuality(symbol, bookTickerMap, ticker24hMap, depthMap, depthLevels) {
  const bookTicker = bookTickerMap?.[symbol] || null;
  const ticker24h = ticker24hMap?.[symbol] || null;
  const depth = depthMap?.[symbol] || null;

  const spreadPct = calculateSpreadPct(bookTicker);
  const imbalance = calculateOrderbookImbalance(depth, depthLevels);
  const liquidityScore = calculateLiquidityScore(ticker24h?.quoteVolume, imbalance.totalNotional);
  const imbalanceSkew = imbalance.buyPct == null ? 100 : Math.abs(imbalance.buyPct - 50) * 2;

  const output = {
    spreadPct: toRounded(spreadPct, 4),
    imbalanceBuyPct: toRounded(imbalance.buyPct, 2),
    imbalanceSellPct: toRounded(imbalance.sellPct, 2),
    liquidityScore,
    executionQuality: classifyExecutionQuality(spreadPct, liquidityScore, imbalanceSkew),
    slippageRisk: classifySlippageRisk(spreadPct, liquidityScore, imbalance.totalNotional)
  };

  if (output.spreadPct == null || output.imbalanceBuyPct == null) {
    return {
      ...getEmptyQuality(),
      liquidityScore
    };
  }

  return output;
}

async function getExecutionQualityForSymbols(symbols, options = {}) {
  const sanitizedSymbols = sanitizeSymbols(symbols);
  if (sanitizedSymbols.length === 0) return {};

  const depthLevels = Number(options.depthLevels) > 0 ? Number(options.depthLevels) : DEFAULT_DEPTH_LEVELS;
  const orderBookLimit = Number(options.orderBookLimit) > 0 ? Number(options.orderBookLimit) : DEFAULT_ORDER_BOOK_LIMIT;

  const [bookTickerRaw, ticker24hRaw, depthMap] = await Promise.all([
    getBookTicker(sanitizedSymbols),
    get24hTicker(sanitizedSymbols),
    fetchDepthMap(sanitizedSymbols, orderBookLimit)
  ]);

  const bookTickerMap = typeof bookTickerRaw === 'object' && !Array.isArray(bookTickerRaw)
    ? bookTickerRaw
    : {};
  const ticker24hMap = typeof ticker24hRaw === 'object' && !Array.isArray(ticker24hRaw)
    ? ticker24hRaw
    : {};

  const results = {};
  for (const symbol of sanitizedSymbols) {
    try {
      results[symbol] = computeSymbolQuality(symbol, bookTickerMap, ticker24hMap, depthMap, depthLevels);
    } catch (error) {
      console.log(`[ExecutionQuality] ${symbol} quality calculation fallback: ${error.message}`);
      results[symbol] = getEmptyQuality();
    }
  }

  return results;
}

module.exports = {
  getExecutionQualityForSymbols
};
