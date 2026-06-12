const axios = require('axios');
const NodeCache = require('node-cache');

const RSS_FEEDS = [
  {
    source: 'Cointelegraph',
    url: 'https://cointelegraph.com/rss',
  },
  {
    source: 'CoinDesk',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  },
  {
    source: 'Decrypt',
    url: 'https://decrypt.co/feed',
  },
  {
    source: 'Bitcoin Magazine',
    url: 'https://bitcoinmagazine.com/.rss/full/',
  },
  {
    source: 'CryptoSlate',
    url: 'https://cryptoslate.com/feed/',
  },
  {
    source: 'NewsBTC',
    url: 'https://www.newsbtc.com/feed/',
  },
];

const cache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

function stripHtml(value = '') {
  return decodeXml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTagValue(xml, tagName) {
  const match = String(xml).match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseRssItems(xml, feedSource) {
  const items = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return items.map((item, index) => {
    const title = stripHtml(getTagValue(item, 'title'));
    const url = getTagValue(item, 'link') || getTagValue(item, 'guid');
    const pubDate = getTagValue(item, 'pubDate') || getTagValue(item, 'dc:date');
    const description = stripHtml(getTagValue(item, 'description') || getTagValue(item, 'content:encoded'));
    const imageMatch = item.match(/<media:content[^>]+url=["']([^"']+)["']/i)
      || item.match(/<enclosure[^>]+url=["']([^"']+)["']/i);

    if (!title) return null;

    return {
      id: `${feedSource.toLowerCase()}-${Buffer.from(`${url || title}-${index}`).toString('base64url').slice(0, 16)}`,
      guid: getTagValue(item, 'guid') || url || title,
      title,
      url,
      source: feedSource,
      published_on: pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000),
      body: description,
      imageurl: imageMatch ? decodeXml(imageMatch[1]) : '',
      categories: 'BTC|ETH|Crypto',
      tags: 'rss,news',
      provider: 'rss',
    };
  }).filter(Boolean);
}

function normalizeForDedupe(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dedupeArticles(articles) {
  const seen = new Set();

  return articles.filter((article) => {
    const titleKey = normalizeForDedupe(article.title);
    const urlKey = normalizeForDedupe(article.url);
    const key = titleKey || urlKey;
    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

async function getRssNews(normalizedCategories, normalizedLimit) {
  const cacheKey = `news_rss:${normalizedCategories}:${normalizedLimit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached.slice(0, normalizedLimit);

  const responses = await Promise.allSettled(
    RSS_FEEDS.map((feed) => axios.get(feed.url, {
      timeout: 8000,
      responseType: 'text',
      headers: {
        'User-Agent': 'CoinChakra/1.0 crypto news monitor',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    }).then((response) => parseRssItems(response.data, feed.source)))
  );

  const categoryTokens = normalizedCategories
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const merged = responses
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter((article) => {
      if (categoryTokens.length === 0) return true;
      const haystack = `${article.title} ${article.body} ${article.categories} ${article.tags}`.toUpperCase();
      return categoryTokens.some((token) => haystack.includes(token)) || /CRYPTO|BITCOIN|ETHEREUM|ALTCOIN|BLOCKCHAIN/.test(haystack);
    });

  const ranked = dedupeArticles(merged)
    .sort((a, b) => Number(b.published_on || 0) - Number(a.published_on || 0));

  cache.set(cacheKey, ranked);
  return ranked.slice(0, normalizedLimit);
}

async function getNews(categories = 'BTC,ETH', limit = 10) {
  const normalizedCategories = String(categories || 'BTC,ETH')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .join(',') || 'BTC,ETH';
  const normalizedLimit = Math.max(1, Math.min(30, Number(limit) || 10));

  try {
    return await getRssNews(normalizedCategories, normalizedLimit);
  } catch (error) {
    throw new Error(`Error fetching RSS crypto news: ${error.message}`);
  }
}

module.exports = { getNews };
