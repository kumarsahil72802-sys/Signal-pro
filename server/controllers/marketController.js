const { getBatchPrices, getKlines, getTopUsdtSymbols, get24hTicker } = require('../services/binanceService');
const NodeCache = require('node-cache');
const { getExecutionQualityForSymbols } = require('../services/executionQualityService');
const { getCoinImageCandidatesMap } = require('../services/coinImageService');

const marketQualityCache = new NodeCache({ stdTTL: 6, checkperiod: 3 });
const marketChartCache = new NodeCache({ stdTTL: 15, checkperiod: 5 });
let lastQualityResponse = null;
const CHART_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']);
const DEFAULT_MARKET_LIMIT = 90;
const MAX_MARKET_LIMIT = 180;

function parseMarketLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return DEFAULT_MARKET_LIMIT;
  return Math.max(30, Math.min(MAX_MARKET_LIMIT, Math.round(parsed)));
}

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

function generateFallbackSparkline(lastPrice, changePct = 0) {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return { price: [] };

  const pct = Number.isFinite(changePct) ? changePct : 0;
  const openPrice = lastPrice / (1 + (pct / 100 || 0));
  const safeOpen = Number.isFinite(openPrice) && openPrice > 0 ? openPrice : lastPrice;

  const points = Array.from({ length: 8 }, (_, index) => {
    const t = index / 7;
    const baseline = safeOpen + (lastPrice - safeOpen) * t;
    const wave = Math.sin(t * Math.PI * 2) * (Math.abs(lastPrice - safeOpen) * 0.08);
    return Number((baseline + wave).toFixed(8));
  });

  return { price: points };
}

function createBinanceMarketCoin(pairSymbol, ticker, rankIndex = 0, imageCandidates = []) {
  const baseSymbol = String(pairSymbol || '').replace(/USDT$/, '').toUpperCase();
  const lowerBase = baseSymbol.toLowerCase();
  const currentPrice = Number(ticker?.lastPrice);
  const pct24h = Number(ticker?.priceChangePercent);
  const quoteVolume = Number(ticker?.quoteVolume);
  const high24h = Number(ticker?.highPrice);
  const low24h = Number(ticker?.lowPrice);

  return {
    id: `binance-${lowerBase}`,
    name: baseSymbol,
    symbol: lowerBase,
    image: imageCandidates[0] || null,
    image_candidates: imageCandidates,
    current_price: Number.isFinite(currentPrice) ? currentPrice : null,
    price_change_percentage_24h: Number.isFinite(pct24h) ? pct24h : null,
    market_cap: null,
    market_cap_rank: null,
    total_volume: Number.isFinite(quoteVolume) ? quoteVolume : null,
    high_24h: Number.isFinite(high24h) ? high24h : null,
    low_24h: Number.isFinite(low24h) ? low24h : null,
    ath: null,
    atl: null,
    circulating_supply: null,
    total_supply: null,
    max_supply: null,
    sparkline_in_7d: generateFallbackSparkline(currentPrice, pct24h),
    source: 'binance',
    popularity_rank: rankIndex + 1,
  };
}

const getMarketOverview = async (req, res) => {
  try {
    const limit = parseMarketLimit(req.query.limit);
    const binancePoolLimit = Math.min(Math.max(limit * 2, 120), 300);
    const minQuoteVolume = limit > 120 ? 1_500_000 : 1_000_000;

    const topBinanceSymbols = await getTopUsdtSymbols({
      limit: binancePoolLimit,
      minQuoteVolume,
      excludeStableBases: true
    });

    let ticker24hMap = {};
    let priceMap = {};
    let imageCandidatesMap = {};

    try {
      const baseSymbols = topBinanceSymbols.map((pair) => String(pair || '').replace(/USDT$/, '').toUpperCase());
      const [tickers, prices, imageMap] = await Promise.all([
        get24hTicker(topBinanceSymbols),
        getBatchPrices(topBinanceSymbols),
        getCoinImageCandidatesMap(baseSymbols),
      ]);
      ticker24hMap = (tickers && typeof tickers === 'object' && !Array.isArray(tickers)) ? tickers : {};
      priceMap = (prices && typeof prices === 'object' && !Array.isArray(prices)) ? prices : {};
      imageCandidatesMap = (imageMap && typeof imageMap === 'object' && !Array.isArray(imageMap)) ? imageMap : {};
    } catch (error) {
      console.log(`[Market] Binance market sync failed: ${error.message}`);
    }

    const coins = topBinanceSymbols
      .map((pair, index) => {
        const ticker = ticker24hMap[pair];
        if (!ticker) return null;
        const baseSymbol = String(pair || '').replace(/USDT$/, '').toUpperCase();
        const imageCandidates = Array.isArray(imageCandidatesMap[baseSymbol]) ? imageCandidatesMap[baseSymbol] : [];
        const coin = createBinanceMarketCoin(pair, ticker, index, imageCandidates);
        const livePrice = Number(priceMap[pair]);
        if (Number.isFinite(livePrice) && livePrice > 0) {
          coin.current_price = livePrice;
        }
        return coin;
      })
      .filter(Boolean)
      .filter((coin) => Number.isFinite(coin.current_price) && coin.current_price > 0)
      .sort((a, b) => (Number(b.total_volume) || 0) - (Number(a.total_volume) || 0))
      .slice(0, limit);

    res.json(coins);
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
