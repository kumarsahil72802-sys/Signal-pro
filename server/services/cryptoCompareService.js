const axios = require('axios');
const NodeCache = require('node-cache');

const CRYPTO_COMPARE_BASE = 'https://min-api.cryptocompare.com/data';
const CRYPTO_COMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY;

// Cache with 30 minute TTL for news data (longer than market data)
const cache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });
const CACHE_KEY = 'news_data';

async function getNews(categories = 'BTC,ETH', limit = 10) {
  if (!CRYPTO_COMPARE_API_KEY) {
    throw new Error('CRYPTOCOMPARE_API_KEY is not set. Cannot fetch news.');
  }

  // Check cache first
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    console.log('[CryptoCompare] Returning cached news data');
    return cached.slice(0, limit);
  }

  try {
    const response = await axios.get(`${CRYPTO_COMPARE_BASE}/v2/news/`, {
      params: {
        categories,
        limit,
        api_key: CRYPTO_COMPARE_API_KEY,
      },
      timeout: 8000,
    });

    const data = response.data.Data.map((article) => ({
      title: article.title,
      url: article.url,
      source: article.source,
      published_on: article.published_on,
    }));

    // Store in cache
    cache.set(CACHE_KEY, data);
    console.log('[CryptoCompare] Fresh news data cached');

    return data;
  } catch (error) {
    if (error.response?.status === 429) {
      throw new Error('CryptoCompare rate limit exceeded. Try again later.');
    }
    throw new Error(`Error fetching crypto news: ${error.message}`);
  }
}

module.exports = { getNews };
