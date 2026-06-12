const NodeCache = require('node-cache');
const { getNews } = require('./rssNewsService');
const { askGroqWithMeta } = require('./groqService');

const intelligenceCache = new NodeCache({ stdTTL: 45 * 60, checkperiod: 5 * 60 });
const AI_BATCH_LIMIT = 14;
const HIGH_IMPACT_TERMS = [
  'etf', 'sec', 'lawsuit', 'hack', 'exploit', 'listing', 'delisting', 'approval',
  'ban', 'regulation', 'fed', 'inflation', 'cpi', 'rate cut', 'tariff', 'reserve',
  'whale', 'liquidation', 'outflow', 'inflow', 'partnership', 'upgrade', 'staking'
];
const COIN_TERMS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON', 'TRX', 'DOT', 'MATIC', 'POL'];
const POSITIVE_TERMS = ['surge', 'rally', 'breakout', 'bullish', 'approval', 'partnership', 'upgrade', 'growth', 'inflow', 'record', 'rebound'];
const NEGATIVE_TERMS = ['crash', 'dump', 'bearish', 'hack', 'lawsuit', 'ban', 'rejection', 'liquidation', 'outflow', 'selloff', 'risk', 'decline'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSymbol(symbol = '') {
  return String(symbol || '').replace(/USDT$/, '').trim().toUpperCase();
}

function textOf(article) {
  return `${article?.title || ''} ${article?.body || ''}`.toLowerCase();
}

function countHits(text, terms) {
  return terms.reduce((sum, term) => sum + (text.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function detectCoins(article, preferredCoins = []) {
  const haystack = `${article?.title || ''} ${article?.body || ''}`.toUpperCase();
  const detected = [...preferredCoins, ...COIN_TERMS].filter((coin) => {
    if (!coin) return false;
    return new RegExp(`\\b${coin}\\b`, 'i').test(haystack) || haystack.includes(`${coin} `);
  });
  return [...new Set(detected)].slice(0, 5);
}

function ruleAnalyzeArticle(article, preferredCoins = []) {
  const text = textOf(article);
  const positive = countHits(text, POSITIVE_TERMS);
  const negative = countHits(text, NEGATIVE_TERMS);
  const impactHits = countHits(text, HIGH_IMPACT_TERMS);
  const impactScore = clamp((positive - negative) * 2 + Math.sign(positive - negative) * Math.min(impactHits, 3), -10, 10);
  const riskScore = clamp(countHits(text, ['hack', 'exploit', 'lawsuit', 'ban', 'delisting', 'sec', 'regulation', 'liquidation']) * 2, 0, 10);
  const affectedCoins = detectCoins(article, preferredCoins);

  return {
    relevance: impactHits > 0 || affectedCoins.length > 0 ? 'MEDIUM' : 'LOW',
    bias: impactScore > 2 ? 'BULLISH' : impactScore < -2 ? 'BEARISH' : 'NEUTRAL',
    impactScore,
    riskScore,
    urgency: riskScore >= 6 || Math.abs(impactScore) >= 7 ? 'HIGH' : impactHits > 0 ? 'MEDIUM' : 'LOW',
    affectedCoins: affectedCoins.length > 0 ? affectedCoins : ['MARKET'],
    confidence: impactHits > 0 ? 0.58 : 0.42,
    summary: article?.title || 'RSS news context',
    source: 'rules_fallback'
  };
}

function isHighImpactArticle(article, preferredCoins = []) {
  const text = textOf(article);
  return countHits(text, HIGH_IMPACT_TERMS) > 0 || detectCoins(article, preferredCoins).length > 0;
}

function buildPrompt(articles, preferredCoins = []) {
  const payload = articles.map((article, index) => ({
    index,
    source: article.source,
    title: article.title,
    body: String(article.body || '').slice(0, 420),
    published_on: article.published_on
  }));

  return [
    'You are a crypto trading news intelligence team. Use these internal roles in one pass: Relevance Agent, Coin Mapper Agent, Impact Agent, Risk Agent, Final Judge.',
    'Analyze only trading impact. Ignore hype/noise. Return strict JSON only, no markdown.',
    'Schema: {"items":[{"index":0,"relevance":"LOW|MEDIUM|HIGH","bias":"BULLISH|BEARISH|NEUTRAL","impactScore":-10,"riskScore":0,"urgency":"LOW|MEDIUM|HIGH","affectedCoins":["BTC"],"confidence":0.0,"summary":"max 18 words"}]}',
    'Rules: impactScore is -10 to 10. riskScore is 0 to 10. affectedCoins can include MARKET. Prefer specific tickers.',
    `Preferred coins: ${preferredCoins.length ? preferredCoins.join(',') : 'BTC,ETH,MARKET'}`,
    `Articles: ${JSON.stringify(payload)}`
  ].join('\n');
}

function parseAiJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeAiItem(item, fallback) {
  const impactScore = clamp(Number(item?.impactScore), -10, 10);
  const riskScore = clamp(Number(item?.riskScore), 0, 10);
  const confidence = clamp(Number(item?.confidence), 0, 1);

  return {
    relevance: ['LOW', 'MEDIUM', 'HIGH'].includes(String(item?.relevance || '').toUpperCase())
      ? String(item.relevance).toUpperCase()
      : fallback.relevance,
    bias: ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(String(item?.bias || '').toUpperCase())
      ? String(item.bias).toUpperCase()
      : fallback.bias,
    impactScore: Number.isFinite(impactScore) ? impactScore : fallback.impactScore,
    riskScore: Number.isFinite(riskScore) ? riskScore : fallback.riskScore,
    urgency: ['LOW', 'MEDIUM', 'HIGH'].includes(String(item?.urgency || '').toUpperCase())
      ? String(item.urgency).toUpperCase()
      : fallback.urgency,
    affectedCoins: Array.isArray(item?.affectedCoins) && item.affectedCoins.length > 0
      ? item.affectedCoins.map(normalizeSymbol).filter(Boolean).slice(0, 5)
      : fallback.affectedCoins,
    confidence: Number.isFinite(confidence) ? confidence : fallback.confidence,
    summary: String(item?.summary || fallback.summary || '').slice(0, 180),
    source: 'groq_multi_agent'
  };
}

function attachIntelligence(articles, intelligenceByIndex, preferredCoins, sourceStatus, error = null) {
  return articles.map((article, index) => ({
    ...article,
    intelligence: intelligenceByIndex.get(index) || {
      ...ruleAnalyzeArticle(article, preferredCoins),
      source: sourceStatus,
      error: error || undefined
    }
  }));
}

async function getNewsWithIntelligence(categories = 'BTC,ETH', limit = 24) {
  const normalizedCategories = String(categories || 'BTC,ETH')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean)
    .join(',') || 'BTC,ETH';
  const normalizedLimit = Math.max(3, Math.min(30, Number(limit) || 24));
  const cacheKey = `news_intel:${normalizedCategories}:${normalizedLimit}`;
  const cached = intelligenceCache.get(cacheKey);
  if (cached) return cached;

  const articles = await getNews(normalizedCategories, normalizedLimit);
  const preferredCoins = normalizedCategories.split(',').filter(Boolean);
  const candidates = articles
    .map((article, index) => ({ article, index }))
    .filter(({ article }) => isHighImpactArticle(article, preferredCoins))
    .slice(0, AI_BATCH_LIMIT);

  if (candidates.length === 0) {
    const fallback = attachIntelligence(articles, new Map(), preferredCoins, 'rules_fallback');
    intelligenceCache.set(cacheKey, fallback);
    return fallback;
  }

  const fallbackText = JSON.stringify({
    items: candidates.map(({ article }, index) => ({ index, ...ruleAnalyzeArticle(article, preferredCoins) }))
  });
  const response = await askGroqWithMeta(
    buildPrompt(candidates.map(({ article }) => article), preferredCoins),
    fallbackText,
    { retryCount: 0, timeoutMs: 18000, maxTokens: 1600 }
  );
  const parsed = parseAiJson(response.text) || parseAiJson(fallbackText);
  const intelligenceByIndex = new Map();

  for (const item of Array.isArray(parsed?.items) ? parsed.items : []) {
    const batchIndex = Number(item.index);
    const candidate = candidates[batchIndex];
    if (!candidate) continue;
    const fallback = ruleAnalyzeArticle(candidate.article, preferredCoins);
    const normalized = normalizeAiItem(item, fallback);
    if (response.error) normalized.source = 'rules_fallback';
    intelligenceByIndex.set(candidate.index, normalized);
  }

  const sourceStatus = response.error ? 'rules_fallback' : 'groq_multi_agent';
  const enriched = attachIntelligence(articles, intelligenceByIndex, preferredCoins, sourceStatus, response.error);
  intelligenceCache.set(cacheKey, enriched);
  return enriched;
}

module.exports = {
  getNewsWithIntelligence,
  ruleAnalyzeArticle
};
