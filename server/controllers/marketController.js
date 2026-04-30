const { getTopCoins } = require('../services/coingeckoService');
const { getBatchPrices, getKlines } = require('../services/binanceService');
const NodeCache = require('node-cache');
const { getExecutionQualityForSymbols } = require('../services/executionQualityService');

const marketQualityCache = new NodeCache({ stdTTL: 6, checkperiod: 3 });
const marketChartCache = new NodeCache({ stdTTL: 15, checkperiod: 5 });
let lastQualityResponse = null;
const CHART_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']);

function parseSymbolsQuery(rawSymbols) {
  if (!rawSymbols) return [];

  return [...new Set(
    String(rawSymbols)
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => Boolean(symbol))
  )];
}

function parseChartInterval(rawInterval) {
  const interval = String(rawInterval || '15m').trim().toLowerCase();
  if (!CHART_INTERVALS.has(interval)) return '15m';
  return interval;
}

function parseChartLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return 72;
  return Math.max(24, Math.min(240, Math.round(parsed)));
}

function parseChartSymbol(rawSymbol) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(symbol)) return null;
  return symbol;
}

const getMarketOverview = async (req, res) => {
  try {
    const coins = await getTopCoins();

    const usdtPairs = coins
      .map((coin) => `${String(coin.symbol || '').toUpperCase()}USDT`)
      .filter((pair) => /^[A-Z0-9]+USDT$/.test(pair));

    let binancePrices = {};
    try {
      binancePrices = await getBatchPrices(usdtPairs);
    } catch (error) {
      console.log(`[Market] Binance price sync failed, using fallback prices: ${error.message}`);
    }

    const merged = coins.map((coin) => {
      const pair = `${String(coin.symbol || '').toUpperCase()}USDT`;
      const binancePrice = binancePrices[pair];

      return {
        ...coin,
        current_price: typeof binancePrice === 'number' ? binancePrice : coin.current_price
      };
    });

    res.json(merged);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMarketQuality = async (req, res) => {
  const symbols = parseSymbolsQuery(req.query.symbols);
  const cacheKey = symbols.slice().sort().join(',') || 'EMPTY';

  const cached = marketQualityCache.get(cacheKey);
  if (cached) {
    return res.json({
      ...cached,
      cached: true
    });
  }

  try {
    const qualityMap = await getExecutionQualityForSymbols(symbols);
    const payload = {
      cached: false,
      symbols,
      updatedAt: new Date().toISOString(),
      data: qualityMap
    };

    marketQualityCache.set(cacheKey, payload);
    lastQualityResponse = payload;
    res.json(payload);
  } catch (error) {
    console.log(`[Market] Quality fetch failed: ${error.message}`);

    if (lastQualityResponse) {
      return res.json({
        ...lastQualityResponse,
        cached: true,
        stale: true,
        warning: 'Serving last known quality snapshot due to upstream failure'
      });
    }

    res.status(503).json({
      cached: false,
      symbols,
      updatedAt: new Date().toISOString(),
      data: {},
      message: 'Market quality unavailable'
    });
  }
};

const getMarketChart = async (req, res) => {
  const symbol = parseChartSymbol(req.query.symbol);
  if (!symbol) {
    return res.status(400).json({ message: 'Invalid symbol. Example: BTCUSDT' });
  }

  const interval = parseChartInterval(req.query.interval);
  const limit = parseChartLimit(req.query.limit);
  const cacheKey = `${symbol}:${interval}:${limit}`;
  const cached = marketChartCache.get(cacheKey);
  if (cached) {
    return res.json({
      ...cached,
      cached: true
    });
  }

  try {
    const klines = await getKlines(symbol, interval, limit);
    const points = klines.map((candle) => ({
      time: candle.closeTime || candle.openTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    }));

    const payload = {
      symbol,
      interval,
      points,
      updatedAt: new Date().toISOString(),
      cached: false
    };
    marketChartCache.set(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    res.status(503).json({ message: `Chart unavailable: ${error.message}` });
  }
};

module.exports = { getMarketOverview, getMarketQuality, getMarketChart };
