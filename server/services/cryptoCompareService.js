const axios = require('axios');
const NodeCache = require('node-cache');

const CRYPTO_COMPARE_BASE = 'https://min-api.cryptocompare.com/data';
const CRYPTO_COMPARE_API_KEY = process.env.CRYPTOCOMPARE_API_KEY;

// Cache with 30 minute TTL for news data (longer than market data)
const cache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

async function getNews(categories = 'BTC,ETH', limit = 10) {
  if (!CRYPTO_COMPARE_API_KEY) {
    throw new Error('CRYPTOCOMPARE_API_KEY is not set. Cannot fetch news.');
  }

  const normalizedCategories = String(categories || 'BTC,ETH')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .join(',') || 'BTC,ETH';
  const normalizedLimit = Math.max(1, Math.min(30, Number(limit) || 10));
  const cacheKey = `news_data:${normalizedCategories}:${normalizedLimit}`;

  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('[CryptoCompare] Returning cached news data');
    return cached.slice(0, normalizedLimit);
  }

  try {
    const response = await axios.get(`${CRYPTO_COMPARE_BASE}/v2/news/`, {
      params: {
        categories: normalizedCategories,
        limit: normalizedLimit,
        api_key: CRYPTO_COMPARE_API_KEY,
      },
      timeout: 8000,
    });

    if (!Array.isArray(response.data?.Data)) {
      throw new Error(response.data?.Message || 'Invalid news response from CryptoCompare');
    }

    const data = response.data.Data.map((article) => ({
      id: article.id,
      guid: article.guid,
      title: article.title,
      url: article.url,
      source: article.source,
      published_on: article.published_on,
      body: article.body,
      imageurl: article.imageurl,
      categories: article.categories,
      tags: article.tags,
    }));

    // Store in cache
    cache.set(cacheKey, data);
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
