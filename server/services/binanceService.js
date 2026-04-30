const axios = require('axios');

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;

const getHeaders = () => {
  if (!BINANCE_API_KEY) {
    console.warn('[Binance] API key not set. Some endpoints may be rate-limited.');
    return {};
  }
  return { 'X-MBX-APIKEY': BINANCE_API_KEY };
};

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

async function getKlines(symbol, interval = '1h', limit = 100) { // 100 candles for accurate RSI/MACD calculation
  try {
    const response = await axios.get(`${BINANCE_BASE}/klines`, {
      headers: getHeaders(),
      params: { symbol, interval, limit },
      timeout: 5000
    });
    return response.data.map(k => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6]
    }));
  } catch (error) {
    throw new Error(`Error fetching klines for ${symbol}: ${error.message}`);
  }
}

module.exports = { getLivePrice, getBatchPrices, getKlines };
