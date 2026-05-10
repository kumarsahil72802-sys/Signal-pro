const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300 });
const BASE = 'https://fapi.binance.com';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function avg(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function trendPct(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length < 2) return null;
  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  if (!Number.isFinite(first) || first === 0 || !Number.isFinite(last)) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

function latestFromSeries(series, key) {
  if (!Array.isArray(series) || series.length === 0) return null;
  return toNumber(series[series.length - 1]?.[key]);
}

function mapSeries(series, key) {
  if (!Array.isArray(series)) return [];
  return series.map((item) => toNumber(item?.[key])).filter((value) => Number.isFinite(value));
}

async function getFuturesContext(symbol) {
  const cacheKey = `futures_${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const [fundingRes, lsRatioRes, takerRes, oiRes, fundingHistoryRes, oiHistoryRes, topPositionRes, topAccountRes] = await Promise.allSettled([
      axios.get(`${BASE}/fapi/v1/premiumIndex`, { params: { symbol }, timeout: 5000 }),
      axios.get(`${BASE}/futures/data/globalLongShortAccountRatio`, {
        params: { symbol, period: '1h', limit: 8 },
        timeout: 5000
      }),
      axios.get(`${BASE}/futures/data/takerlongshortRatio`, {
        params: { symbol, period: '1h', limit: 8 },
        timeout: 5000
      }),
      axios.get(`${BASE}/fapi/v1/openInterest`, { params: { symbol }, timeout: 5000 }),
      axios.get(`${BASE}/fapi/v1/fundingRate`, {
        params: { symbol, limit: 12 },
        timeout: 5000
      }),
      axios.get(`${BASE}/futures/data/openInterestHist`, {
        params: { symbol, period: '1h', limit: 12 },
        timeout: 5000
      }),
      axios.get(`${BASE}/futures/data/topLongShortPositionRatio`, {
        params: { symbol, period: '1h', limit: 8 },
        timeout: 5000
      }),
      axios.get(`${BASE}/futures/data/topLongShortAccountRatio`, {
        params: { symbol, period: '1h', limit: 8 },
        timeout: 5000
      })
    ]);

    const fundingHistorySeries = fundingHistoryRes.status === 'fulfilled' ? fundingHistoryRes.value.data : [];
    const oiHistorySeries = oiHistoryRes.status === 'fulfilled' ? oiHistoryRes.value.data : [];
    const lsSeries = lsRatioRes.status === 'fulfilled' ? lsRatioRes.value.data : [];
    const takerSeries = takerRes.status === 'fulfilled' ? takerRes.value.data : [];
    const topPositionSeries = topPositionRes.status === 'fulfilled' ? topPositionRes.value.data : [];
    const topAccountSeries = topAccountRes.status === 'fulfilled' ? topAccountRes.value.data : [];

    const fundingRates = mapSeries(fundingHistorySeries, 'fundingRate');
    const oiHistory = mapSeries(oiHistorySeries, 'sumOpenInterest');
    const oiValueHistory = mapSeries(oiHistorySeries, 'sumOpenInterestValue');
    const lsRatios = mapSeries(lsSeries, 'longShortRatio');
    const takerRatios = mapSeries(takerSeries, 'buySellRatio');
    const topPositionRatios = mapSeries(topPositionSeries, 'longShortRatio');
    const topAccountRatios = mapSeries(topAccountSeries, 'longShortRatio');

    const topPositionLatest = latestFromSeries(topPositionSeries, 'longShortRatio');
    const topAccountLatest = latestFromSeries(topAccountSeries, 'longShortRatio');

    const crowdingBias = (() => {
      const values = [topPositionLatest, topAccountLatest].filter((value) => Number.isFinite(value));
      if (values.length === 0) return null;
      return avg(values);
    })();

    const result = {
      fundingRate: fundingRes.status === 'fulfilled'
        ? toNumber(fundingRes.value.data.lastFundingRate)
        : null,
      markPrice: fundingRes.status === 'fulfilled'
        ? toNumber(fundingRes.value.data.markPrice)
        : null,
      longShortRatio: lsRatios.length > 0 ? lsRatios[lsRatios.length - 1] : null,
      longShortRatioAvg: avg(lsRatios),
      longShortRatioTrendPct: trendPct(lsRatios),
      takerBuySellRatio: takerRatios.length > 0 ? takerRatios[takerRatios.length - 1] : null,
      takerBuySellRatioAvg: avg(takerRatios),
      takerBuySellRatioTrendPct: trendPct(takerRatios),
      openInterest: oiRes.status === 'fulfilled'
        ? toNumber(oiRes.value.data.openInterest)
        : null,
      fundingRateAvg: avg(fundingRates),
      fundingRateTrendPct: trendPct(fundingRates),
      openInterestTrendPct: trendPct(oiHistory),
      openInterestValueTrendPct: trendPct(oiValueHistory),
      topTraderPositionRatio: topPositionLatest,
      topTraderPositionTrendPct: trendPct(topPositionRatios),
      topTraderAccountRatio: topAccountLatest,
      topTraderAccountTrendPct: trendPct(topAccountRatios),
      crowdingBias
    };

    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[Futures] Error for ${symbol}: ${e.message}`);
    return null;
  }
}

module.exports = { getFuturesContext };
