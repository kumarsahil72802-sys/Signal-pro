const axios = require('axios');
const NodeCache = require('node-cache');

const CRYPTOCOMPARE_COINLIST_URL = 'https://min-api.cryptocompare.com/data/all/coinlist';
const COINPAPRIKA_COINS_URL = 'https://api.coinpaprika.com/v1/coins';
const GITHUB_ICON_BASE = 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/icon';
const CRYPTOCOMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY;

const imageCache = new NodeCache({ stdTTL: 12 * 60 * 60, checkperiod: 10 * 60 });

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function buildGithubIcon(symbol) {
  const normalized = normalizeSymbol(symbol).toLowerCase();
  if (!/^[a-z0-9]{2,16}$/.test(normalized)) return '';
  return `${GITHUB_ICON_BASE}/${normalized}.png`;
}

function toAbsoluteCryptoCompareUrl(imageUrl, baseImageUrl) {
  if (!imageUrl) return '';
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

  const base = String(baseImageUrl || 'https://www.cryptocompare.com').replace(/\/$/, '');
  const path = String(imageUrl).startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${base}${path}`;
}

function pickBetterCoinPaprikaRecord(current, candidate) {
  if (!current) return candidate;

  const currentActive = current.is_active === true;
  const candidateActive = candidate.is_active === true;
  if (currentActive !== candidateActive) return candidateActive ? candidate : current;

  const currentRank = Number(current.rank);
  const candidateRank = Number(candidate.rank);
  const currentRankScore = Number.isFinite(currentRank) && currentRank > 0 ? currentRank : Number.POSITIVE_INFINITY;
  const candidateRankScore = Number.isFinite(candidateRank) && candidateRank > 0 ? candidateRank : Number.POSITIVE_INFINITY;

  if (candidateRankScore < currentRankScore) return candidate;
  return current;
}

async function getCryptoCompareImageMap() {
  const cached = imageCache.get('cryptocompare_image_map');
  if (cached) return cached;

  if (!CRYPTOCOMPARE_API_KEY) {
    console.log('[CoinImage] CRYPTOCOMPARE_API_KEY missing for image map');
  }

  try {
    const response = await axios.get(CRYPTOCOMPARE_COINLIST_URL, {
      params: CRYPTOCOMPARE_API_KEY ? { api_key: CRYPTOCOMPARE_API_KEY } : undefined,
      timeout: 12000,
    });
    const baseImageUrl = response?.data?.BaseImageUrl || 'https://www.cryptocompare.com';
    const rows = response?.data?.Data || {};
    const map = {};

    for (const key of Object.keys(rows)) {
      const row = rows[key];
      const symbol = normalizeSymbol(row?.Symbol || key);
      if (!symbol) continue;
      const image = toAbsoluteCryptoCompareUrl(row?.ImageUrl, baseImageUrl);
      if (!image) continue;
      map[symbol] = image;
    }

    imageCache.set('cryptocompare_image_map', map);
    return map;
  } catch (error) {
    console.log(`[CoinImage] CryptoCompare image map unavailable: ${error.message}`);
    return {};
  }
}

async function getCoinPaprikaImageMap() {
  const cached = imageCache.get('coinpaprika_image_map');
  if (cached) return cached;

  try {
    const response = await axios.get(COINPAPRIKA_COINS_URL, { timeout: 12000 });
    const rows = Array.isArray(response.data) ? response.data : [];
    const bestBySymbol = {};

    for (const row of rows) {
      const symbol = normalizeSymbol(row?.symbol);
      if (!symbol) continue;
      bestBySymbol[symbol] = pickBetterCoinPaprikaRecord(bestBySymbol[symbol], row);
    }

    const map = {};
    for (const [symbol, row] of Object.entries(bestBySymbol)) {
      if (!row?.id) continue;
      map[symbol] = `https://static.coinpaprika.com/coin/${row.id}/logo.png`;
    }

    imageCache.set('coinpaprika_image_map', map);
    return map;
  } catch (error) {
    console.log(`[CoinImage] CoinPaprika image map unavailable: ${error.message}`);
    return {};
  }
}

async function getCoinImageCandidatesMap(symbols = []) {
  const list = Array.isArray(symbols) ? symbols.map(normalizeSymbol).filter(Boolean) : [];
  if (list.length === 0) return {};

  const [cryptoCompareMap, coinPaprikaMap] = await Promise.all([
    getCryptoCompareImageMap(),
    getCoinPaprikaImageMap(),
  ]);

  const result = {};
  for (const symbol of list) {
    const candidates = [];

    if (cryptoCompareMap[symbol]) candidates.push(cryptoCompareMap[symbol]);
    if (coinPaprikaMap[symbol]) candidates.push(coinPaprikaMap[symbol]);

    const githubIcon = buildGithubIcon(symbol);
    if (githubIcon) candidates.push(githubIcon);

    result[symbol] = [...new Set(candidates)];
  }

  return result;
}

module.exports = { getCoinImageCandidatesMap };
