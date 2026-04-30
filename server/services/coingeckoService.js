const axios = require('axios');
const NodeCache = require('node-cache');

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Cache with 15 minute TTL for market data
const cache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const CACHE_KEY = 'market_data';

// Track in-flight requests to prevent concurrent API calls
let inFlightRequest = null;
let lastRateLimitTime = 0;
const RATE_LIMIT_COOLDOWN = 60000; // 1 minute cooldown after rate limit

// Demo data as fallback when API is rate-limited
const DEMO_COINS = [
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', current_price: 75907.00, price_change_percentage_24h: -0.93, image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'eth', current_price: 2275.38, price_change_percentage_24h: 0.00, image: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png' },
  { id: 'tether', name: 'Tether', symbol: 'usdt', current_price: 1.00, price_change_percentage_24h: -0.02, image: 'https://assets.coingecko.com/coins/images/325/large/Tether.png' },
  { id: 'ripple', name: 'XRP', symbol: 'xrp', current_price: 1.37, price_change_percentage_24h: -1.04, image: 'https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png' },
  { id: 'binancecoin', name: 'BNB', symbol: 'bnb', current_price: 622.11, price_change_percentage_24h: 0.10, image: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png' },
  { id: 'usd-coin', name: 'USDC', symbol: 'usdc', current_price: 1.00, price_change_percentage_24h: 0.00, image: 'https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png' },
  { id: 'solana', name: 'Solana', symbol: 'sol', current_price: 83.41, price_change_percentage_24h: -1.01, image: 'https://assets.coingecko.com/coins/images/4128/large/solana.png' },
  { id: 'tron', name: 'TRON', symbol: 'trx', current_price: 0.32, price_change_percentage_24h: -0.57, image: 'https://assets.coingecko.com/coins/images/1094/large/tron-logo.png' },
  { id: 'dogecoin', name: 'Dogecoin', symbol: 'doge', current_price: 0.10, price_change_percentage_24h: 2.10, image: 'https://assets.coingecko.com/coins/images/5/large/dogecoin.png' },
  { id: 'cardano', name: 'Cardano', symbol: 'ada', current_price: 0.45, price_change_percentage_24h: 1.25, image: 'https://assets.coingecko.com/coins/images/975/large/cardano.png' },
];

async function getTopCoins(perPage = 10) {
  // Check cache first
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    return cached.slice(0, perPage);
  }

  // Check rate limit cooldown
  const now = Date.now();
  if (now - lastRateLimitTime < RATE_LIMIT_COOLDOWN) {
    const remaining = Math.ceil((RATE_LIMIT_COOLDOWN - (now - lastRateLimitTime)) / 1000);
    console.log(`[CoinGecko] Rate limit cooldown active (${remaining}s remaining), using demo data`);
    return DEMO_COINS.slice(0, perPage);
  }

  // If a request is already in flight, wait for it
  if (inFlightRequest) {
    try {
      const data = await inFlightRequest;
      return data.slice(0, perPage);
    } catch (err) {
      // If the in-flight request failed, continue to try our own request
    }
  }

  // Create new request
  const requestPromise = (async () => {
    try {
      const response = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: perPage,
          page: 1,
          sparkline: false,
        },
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
        }
      });

      const data = response.data.map((coin) => ({
        name: coin.name,
        symbol: coin.symbol,
        current_price: coin.current_price,
        price_change_percentage_24h: coin.price_change_percentage_24h,
        image: coin.image,
      }));

      // Store in cache
      cache.set(CACHE_KEY, data);
      console.log('[CoinGecko] Fresh market data cached');

      return data;
    } catch (error) {
      console.error('CoinGecko API error:', error.message);
      
      if (error.response?.status === 429) {
        lastRateLimitTime = Date.now();
        console.log('Rate limited, returning demo data');
        return DEMO_COINS.slice(0, perPage);
      }
      
      console.log('API error, returning demo data');
      return DEMO_COINS.slice(0, perPage);
    } finally {
      inFlightRequest = null;
    }
  })();

  inFlightRequest = requestPromise;
  return requestPromise;
}

module.exports = { getTopCoins };
