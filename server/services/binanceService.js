const axios = require('axios');

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const DEFAULT_TIMEOUT_MS = 6000;
const LONG_TIMEOUT_MS = 10000;
const FALLBACK_MAX_AGE_MS = 2 * 60 * 1000;
const STABLE_BASE_ASSETS = new Set([
  'USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'PYUSD'
]);
const responseCache = new Map();

const getHeaders = () => {
  if (!BINANCE_API_KEY) {
    console.warn('[Binance] API key not set. Some endpoints may be rate-limited.');
    return {};
  }
  return { 'X-MBX-APIKEY': BINANCE_API_KEY };
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeSymbolList(symbols) {
  if (!Array.isArray(symbols)) return [];
  return [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
}

function cacheSet(key, value) {
  responseCache.set(key, { value, updatedAt: Date.now() });
}

function cacheGet(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.updatedAt > FALLBACK_MAX_AGE_MS) {
    responseCache.delete(key);
    return null;
  }

  return entry.value;
}

function extractBinanceError(error, context) {
  if (error.code === 'ECONNABORTED') {
    return `${context} timed out`;
  }
  if (error.response?.status === 400) {
    return `${context} rejected by Binance (invalid params/symbol)`;
  }
  if (error.response?.status === 429) {
    return `${context} rate-limited by Binance`;
  }
  return `${context} failed: ${error.message}`;
}

function parseBookTicker(row) {
  if (!row?.symbol) return null;
  return {
    symbol: row.symbol,
    bidPrice: Number(row.bidPrice),
    bidQty: Number(row.bidQty),
    askPrice: Number(row.askPrice),
    askQty: Number(row.askQty)
  };
}

function normalizeBookTickerPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.reduce((acc, row) => {
      const parsed = parseBookTicker(row);
      if (parsed) acc[parsed.symbol] = parsed;
      return acc;
    }, {});
  }

  const parsed = parseBookTicker(payload);
  return parsed || null;
}

const TICKER_24H_NUMERIC_FIELDS = new Set([
  'priceChange',
  'priceChangePercent',
  'weightedAvgPrice',
  'prevClosePrice',
  'lastPrice',
  'lastQty',
  'bidPrice',
  'bidQty',
  'askPrice',
  'askQty',
  'openPrice',
  'highPrice',
  'lowPrice',
  'volume',
  'quoteVolume'
]);

function parse24hTickerRow(row) {
  if (!row?.symbol) return null;

  const normalized = { ...row };
  for (const key of Object.keys(normalized)) {
    if (TICKER_24H_NUMERIC_FIELDS.has(key)) {
      normalized[key] = Number(normalized[key]);
    }
  }

  normalized.firstId = row.firstId != null ? Number(row.firstId) : null;
  normalized.lastId = row.lastId != null ? Number(row.lastId) : null;
  normalized.count = row.count != null ? Number(row.count) : null;
  normalized.openTime = row.openTime != null ? Number(row.openTime) : null;
  normalized.closeTime = row.closeTime != null ? Number(row.closeTime) : null;

  return normalized;
}

function normalize24hTickerPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.reduce((acc, row) => {
      const parsed = parse24hTickerRow(row);
      if (parsed) acc[parsed.symbol] = parsed;
      return acc;
    }, {});
  }

  const parsed = parse24hTickerRow(payload);
  return parsed || null;
}

function parseOrderBookPayload(symbol, payload) {
  const safePayload = payload || {};
  const bids = Array.isArray(safePayload.bids) ? safePayload.bids : [];
  const asks = Array.isArray(safePayload.asks) ? safePayload.asks : [];

  return {
    symbol,
    lastUpdateId: safePayload.lastUpdateId != null ? Number(safePayload.lastUpdateId) : null,
    bids: bids.map(([price, qty]) => [Number(price), Number(qty)]),
    asks: asks.map(([price, qty]) => [Number(price), Number(qty)])
  };
}

async function getLivePrice(symbol) {
  try {
    const response = await axios.get(`${BINANCE_BASE}/ticker/price`, {
      headers: getHeaders(),
      params: { symbol },
      timeout: 5000
    });
    return parseFloat(response.data.price);
  } catch (error) {
    if (error.response?.status === 400) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }
    throw new Error(`Error fetching price for ${symbol}: ${error.message}`);
  }
}

async function getBatchPrices(symbols) {
  if (!symbols || symbols.length === 0) return {};

  try {
    const response = await axios.get(`${BINANCE_BASE}/ticker/price`, {
      headers: getHeaders(),
      timeout: 10000
    });

    const priceMap = {};
    const symbolSet = new Set(symbols);

    for (const item of response.data) {
      if (symbolSet.has(item.symbol)) {
        priceMap[item.symbol] = parseFloat(item.price);
      }
    }

    return priceMap;
  } catch (error) {
    throw new Error(`Batch price fetch failed: ${error.message}`);
  }
}

async function getKlines(symbol, interval = '1h', limit = 100, options = {}) { // 100 candles for accurate RSI/MACD calculation
  try {
    const params = { symbol, interval, limit };
    if (options.startTime != null) params.startTime = Number(options.startTime);
    if (options.endTime != null) params.endTime = Number(options.endTime);

    const response = await axios.get(`${BINANCE_BASE}/klines`, {
      headers: getHeaders(),
      params,
      timeout: 5000
    });
    return response.data.map(k => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      quoteVolume: parseFloat(k[7]),
      numberOfTrades: Number(k[8]),
      takerBuyVolume: parseFloat(k[9])
    }));
  } catch (error) {
    throw new Error(`Error fetching klines for ${symbol}: ${error.message}`);
  }
}

async function getBookTicker(symbols) {
  const isSingleSymbol = typeof symbols === 'string';
  const normalizedSymbols = isSingleSymbol
    ? [normalizeSymbol(symbols)]
    : normalizeSymbolList(symbols);

  const cacheKey = isSingleSymbol
    ? `bookTicker:${normalizedSymbols[0]}`
    : `bookTicker:${normalizedSymbols.join(',') || 'ALL'}`;

  const params = {};
  if (isSingleSymbol && normalizedSymbols[0]) {
    params.symbol = normalizedSymbols[0];
  } else if (normalizedSymbols.length > 0) {
    params.symbols = JSON.stringify(normalizedSymbols);
  }

  try {
    const response = await axios.get(`${BINANCE_BASE}/ticker/bookTicker`, {
      headers: getHeaders(),
      params,
      timeout: DEFAULT_TIMEOUT_MS
    });

    const normalized = normalizeBookTickerPayload(response.data);
    cacheSet(cacheKey, normalized);
    return normalized;
  } catch (error) {
    const fallback = cacheGet(cacheKey);
    if (fallback) {
      console.log(`[Binance] ${extractBinanceError(error, 'Book ticker')} - using cached fallback`);
      return fallback;
    }

    console.log(`[Binance] ${extractBinanceError(error, 'Book ticker')} - returning safe fallback`);
    return isSingleSymbol ? null : {};
  }
}

async function getOrderBook(symbol, limit = 50) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const allowedLimits = new Set([5, 10, 20, 50, 100, 500, 1000, 5000]);
  const safeLimit = allowedLimits.has(Number(limit)) ? Number(limit) : 50;
  const cacheKey = `depth:${normalizedSymbol}:${safeLimit}`;

  try {
    const response = await axios.get(`${BINANCE_BASE}/depth`, {
      headers: getHeaders(),
      params: { symbol: normalizedSymbol, limit: safeLimit },
      timeout: LONG_TIMEOUT_MS
    });

    const normalized = parseOrderBookPayload(normalizedSymbol, response.data);
    cacheSet(cacheKey, normalized);
    return normalized;
  } catch (error) {
    const fallback = cacheGet(cacheKey);
    if (fallback) {
      console.log(`[Binance] ${extractBinanceError(error, `Order book ${normalizedSymbol}`)} - using cached fallback`);
      return fallback;
    }

    console.log(`[Binance] ${extractBinanceError(error, `Order book ${normalizedSymbol}`)} - returning empty depth`);
    return parseOrderBookPayload(normalizedSymbol, null);
  }
}

async function get24hTicker(symbols) {
  const isSingleSymbol = typeof symbols === 'string';
  const normalizedSymbols = isSingleSymbol
    ? [normalizeSymbol(symbols)]
    : normalizeSymbolList(symbols);

  const cacheKey = isSingleSymbol
    ? `ticker24h:${normalizedSymbols[0]}`
    : `ticker24h:${normalizedSymbols.join(',') || 'ALL'}`;

  const params = {};
  if (isSingleSymbol && normalizedSymbols[0]) {
    params.symbol = normalizedSymbols[0];
  } else if (normalizedSymbols.length > 0) {
    params.symbols = JSON.stringify(normalizedSymbols);
  }

  try {
    const response = await axios.get(`${BINANCE_BASE}/ticker/24hr`, {
      headers: getHeaders(),
      params,
      timeout: LONG_TIMEOUT_MS
    });

    const normalized = normalize24hTickerPayload(response.data);
    cacheSet(cacheKey, normalized);
    return normalized;
  } catch (error) {
    const fallback = cacheGet(cacheKey);
    if (fallback) {
      console.log(`[Binance] ${extractBinanceError(error, '24h ticker')} - using cached fallback`);
      return fallback;
    }

    console.log(`[Binance] ${extractBinanceError(error, '24h ticker')} - returning safe fallback`);
    return isSingleSymbol ? null : {};
  }
}

function isLeveragedToken(baseAsset) {
  return /(?:UP|DOWN|BULL|BEAR)$/.test(baseAsset);
}

async function getTopUsdtSymbols(options = {}) {
  const {
    limit = 120,
    minQuoteVolume = 2_000_000,
    excludeStableBases = true
  } = options;

  try {
    const [exchangeInfoRes, ticker24hRes] = await Promise.all([
      axios.get(`${BINANCE_BASE}/exchangeInfo`, {
        headers: getHeaders(),
        timeout: 10000
      }),
      axios.get(`${BINANCE_BASE}/ticker/24hr`, {
        headers: getHeaders(),
        timeout: 10000
      })
    ]);

    const tickerMap = new Map(
      ticker24hRes.data.map((t) => [t.symbol, Number(t.quoteVolume || 0)])
    );

    const symbols = exchangeInfoRes.data.symbols
      .filter((s) => s.status === 'TRADING')
      .filter((s) => s.quoteAsset === 'USDT')
      .filter((s) => s.isSpotTradingAllowed)
      .filter((s) => !isLeveragedToken(s.baseAsset))
      .filter((s) => !excludeStableBases || !STABLE_BASE_ASSETS.has(s.baseAsset))
      .map((s) => ({
        symbol: s.symbol,
        quoteVolume: tickerMap.get(s.symbol) || 0
      }))
      .filter((s) => s.quoteVolume >= minQuoteVolume)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, Math.max(1, limit))
      .map((s) => s.symbol);

    return symbols;
  } catch (error) {
    throw new Error(`Error fetching tradable USDT symbols: ${error.message}`);
  }
}

module.exports = {
  getLivePrice,
  getBatchPrices,
  getKlines,
  getTopUsdtSymbols,
  getBookTicker,
  getOrderBook,
  get24hTicker
};
