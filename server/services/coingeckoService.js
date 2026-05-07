const axios = require('axios');
const NodeCache = require('node-cache');

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_SECONDS = 900; // 15 min
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 1 min
const MAX_MARKET_COINS = 250;
const MIN_FETCH_SIZE = 50;
const STALE_BACKUP_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

const cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS, checkperiod: 120 });
const MARKET_CACHE_KEY = 'market_data';

let inFlightRequest = null;
let lastRateLimitTime = 0;
let lastSuccess = {
  data: [],
  fetchedAt: 0
};

function normalizePerPage(perPage) {
  const parsed = Number(perPage);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(MAX_MARKET_COINS, Math.round(parsed)));
}

function mapMarketCoin(coin) {
  return {
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    current_price: coin.current_price,
    price_change_percentage_24h: coin.price_change_percentage_24h,
    image: coin.image,
    market_cap: coin.market_cap,
    market_cap_rank: coin.market_cap_rank,
    total_volume: coin.total_volume,
    high_24h: coin.high_24h,
    low_24h: coin.low_24h,
    ath: coin.ath,
    atl: coin.atl,
    circulating_supply: coin.circulating_supply,
    total_supply: coin.total_supply,
    max_supply: coin.max_supply,
    sparkline_in_7d: {
      price: Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : []
    }
  };
}

function buildStatus(source, reason = null, fetchedAt = null) {
  return {
    source, // fresh | cache | stale_backup | unavailable
    reason,
    fetchedAt
  };
}

function getCachedCoins() {
  const cached = cache.get(MARKET_CACHE_KEY);
  return Array.isArray(cached) ? cached : [];
}

function getStaleBackupCoins() {
  if (!Array.isArray(lastSuccess.data) || lastSuccess.data.length === 0) {
    return [];
  }
  if (Date.now() - lastSuccess.fetchedAt > STALE_BACKUP_MAX_AGE_MS) {
    return [];
  }
  return lastSuccess.data;
}

async function fetchTopCoinsFromApi(fetchSize) {
  const response = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
    params: {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: fetchSize,
      page: 1,
      sparkline: true
    },
    timeout: 10000,
    headers: {
      Accept: 'application/json'
    }
  });

  const mapped = Array.isArray(response.data)
    ? response.data.map(mapMarketCoin)
    : [];

  cache.set(MARKET_CACHE_KEY, mapped);
  lastSuccess = {
    data: mapped,
    fetchedAt: Date.now()
  };
  console.log(`[CoinGecko] Fresh market data cached (${mapped.length} coins)`);
  return mapped;
}

async function getTopCoinsSnapshot(perPage = 10, options = {}) {
  const requested = normalizePerPage(perPage);
  const allowStale = options.allowStale !== false;
  const now = Date.now();

  const cached = getCachedCoins();
  if (cached.length >= requested) {
    return {
      coins: cached.slice(0, requested),
      status: buildStatus('cache', null, new Date(lastSuccess.fetchedAt || now).toISOString())
    };
  }

  if (now - lastRateLimitTime < RATE_LIMIT_COOLDOWN_MS) {
    const stale = allowStale ? getStaleBackupCoins() : [];
    if (stale.length >= requested) {
      const remainingSec = Math.ceil((RATE_LIMIT_COOLDOWN_MS - (now - lastRateLimitTime)) / 1000);
      return {
        coins: stale.slice(0, requested),
        status: buildStatus('stale_backup', `rate_limit_cooldown_${remainingSec}s`, new Date(lastSuccess.fetchedAt).toISOString())
      };
    }

    return {
      coins: [],
      status: buildStatus('unavailable', 'rate_limit_cooldown_and_no_stale_data')
    };
  }

  if (inFlightRequest) {
    try {
      const sharedData = await inFlightRequest;
      return {
        coins: sharedData.slice(0, requested),
        status: buildStatus('fresh', null, new Date(lastSuccess.fetchedAt || Date.now()).toISOString())
      };
    } catch {
      // Let this call execute a normal fetch/fallback path below.
    }
  }

  const fetchSize = Math.max(MIN_FETCH_SIZE, requested);
  const requestPromise = fetchTopCoinsFromApi(fetchSize);
  inFlightRequest = requestPromise;

  try {
    const data = await requestPromise;
    return {
      coins: data.slice(0, requested),
      status: buildStatus('fresh', null, new Date(lastSuccess.fetchedAt).toISOString())
    };
  } catch (error) {
    if (error.response?.status === 429) {
      lastRateLimitTime = Date.now();
    }

    const reason = error.response?.status
      ? `api_error_${error.response.status}`
      : `api_error_${error.code || 'unknown'}`;

    const stale = allowStale ? getStaleBackupCoins() : [];
    if (stale.length >= requested) {
      console.log(`[CoinGecko] ${reason}; using stale backup (${stale.length} coins)`);
      return {
        coins: stale.slice(0, requested),
        status: buildStatus('stale_backup', reason, new Date(lastSuccess.fetchedAt).toISOString())
      };
    }

    console.log(`[CoinGecko] ${reason}; no stale backup available`);
    return {
      coins: [],
      status: buildStatus('unavailable', reason)
    };
  } finally {
    inFlightRequest = null;
  }
}

async function getTopCoins(perPage = 10, options = {}) {
  const snapshot = await getTopCoinsSnapshot(perPage, options);
  return snapshot.coins;
}

module.exports = {
  getTopCoins,
  getTopCoinsSnapshot
};
