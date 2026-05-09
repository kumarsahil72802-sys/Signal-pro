const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300 });
const BASE = 'https://fapi.binance.com';

async function getFuturesContext(symbol) {
  const cacheKey = `futures_${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const [fundingRes, lsRatioRes, takerRes, oiRes] = await Promise.allSettled([
      axios.get(`${BASE}/fapi/v1/premiumIndex`, { params: { symbol }, timeout: 5000 }),
      axios.get(`${BASE}/futures/data/globalLongShortAccountRatio`, {
        params: { symbol, period: '1h', limit: 1 },
        timeout: 5000
      }),
      axios.get(`${BASE}/futures/data/takerlongshortRatio`, {
        params: { symbol, period: '1h', limit: 1 },
        timeout: 5000
      }),
      axios.get(`${BASE}/fapi/v1/openInterest`, { params: { symbol }, timeout: 5000 })
    ]);

    const result = {
      fundingRate: fundingRes.status === 'fulfilled'
        ? parseFloat(fundingRes.value.data.lastFundingRate)
        : null,
      markPrice: fundingRes.status === 'fulfilled'
        ? parseFloat(fundingRes.value.data.markPrice)
        : null,
      longShortRatio: lsRatioRes.status === 'fulfilled'
        ? parseFloat(lsRatioRes.value.data[0]?.longShortRatio)
        : null,
      takerBuySellRatio: takerRes.status === 'fulfilled'
        ? parseFloat(takerRes.value.data[0]?.buySellRatio)
        : null,
      openInterest: oiRes.status === 'fulfilled'
        ? parseFloat(oiRes.value.data.openInterest)
        : null
    };

    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[Futures] Error for ${symbol}: ${e.message}`);
    return null;
  }
}

module.exports = { getFuturesContext };
