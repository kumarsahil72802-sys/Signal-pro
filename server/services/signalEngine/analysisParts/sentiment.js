const { getNewsWithIntelligence } = require('../../newsIntelligenceService');
const { getMacroTrendSnapshot } = require('../../macroService');
const { settings } = require('../config');

const {
  SIGNAL_SENTIMENT_NEWS_LIMIT,
  SIGNAL_SENTIMENT_ENABLED
} = settings;

const POSITIVE_KEYWORDS = [
  'surge', 'rally', 'breakout', 'bullish', 'adoption', 'approval', 'partnership',
  'upgrade', 'growth', 'accumulation', 'inflow', 'record', 'rebound'
];
const NEGATIVE_KEYWORDS = [
  'crash', 'dump', 'bearish', 'hack', 'lawsuit', 'ban', 'rejection',
  'liquidation', 'outflow', 'selloff', 'risk', 'decline', 'downgrade'
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function countKeywordHits(text, keywords) {
  return keywords.reduce((sum, keyword) => {
    return sum + (text.includes(keyword) ? 1 : 0);
  }, 0);
}

function scoreArticle(article, baseSymbol) {
  if (article?.intelligence && Number.isFinite(Number(article.intelligence.impactScore))) {
    const affectedCoins = Array.isArray(article.intelligence.affectedCoins)
      ? article.intelligence.affectedCoins.map((coin) => String(coin).toUpperCase())
      : [];
    const relevance = String(article.intelligence.relevance || '').toUpperCase();
    const relevanceWeight = relevance === 'HIGH' ? 1 : relevance === 'MEDIUM' ? 0.75 : 0.45;
    const coinWeight = baseSymbol && affectedCoins.includes(baseSymbol) ? 1 : affectedCoins.includes('MARKET') ? 0.8 : 0.55;
    const riskDrag = Number(article.intelligence.riskScore || 0) >= 7 ? 0.15 : 0;
    return clamp((Number(article.intelligence.impactScore) / 10) * relevanceWeight * coinWeight - riskDrag, -1, 1);
  }

  const title = normalizeText(article?.title);
  const body = normalizeText(article?.body);
  const content = `${title} ${body}`;
  if (!content.trim()) return 0;

  const positiveHits = countKeywordHits(content, POSITIVE_KEYWORDS);
  const negativeHits = countKeywordHits(content, NEGATIVE_KEYWORDS);
  const raw = positiveHits - negativeHits;
  if (raw === 0) return 0;

  // Heavier weight if symbol is explicitly mentioned in the headline/body.
  const mentionsSymbol = baseSymbol && content.includes(baseSymbol.toLowerCase());
  const relevanceBoost = mentionsSymbol ? 1.2 : 0.8;
  return clamp(raw * 0.18 * relevanceBoost, -1, 1);
}

function deriveMacroBias(macroSnapshot, trend) {
  if (!macroSnapshot || !trend) return 0;

  const dxyDirection = String(macroSnapshot.dxy?.direction || 'FLAT').toUpperCase();
  const dxyStrength = String(macroSnapshot.dxy?.strength || 'WEAK').toUpperCase();
  const spDirection = String(macroSnapshot.sp500?.direction || 'FLAT').toUpperCase();
  const spStrength = String(macroSnapshot.sp500?.strength || 'WEAK').toUpperCase();

  let bias = 0;
  if (trend === 'BUY') {
    if (dxyDirection === 'UP') bias -= dxyStrength === 'STRONG' ? 0.18 : 0.1;
    if (spDirection === 'DOWN') bias -= spStrength === 'STRONG' ? 0.18 : 0.1;
    if (spDirection === 'UP') bias += 0.08;
  }
  if (trend === 'SELL') {
    if (dxyDirection === 'UP') bias += dxyStrength === 'STRONG' ? 0.15 : 0.08;
    if (spDirection === 'DOWN') bias += spStrength === 'STRONG' ? 0.15 : 0.08;
    if (spDirection === 'UP') bias -= 0.08;
  }

  return clamp(bias, -0.3, 0.3);
}

function toSentimentSummary(score) {
  if (score >= 0.3) return 'BULLISH';
  if (score <= -0.3) return 'BEARISH';
  return 'NEUTRAL';
}

async function calcNewsSentiment(symbol, options = {}) {
  const trend = String(options.trend || '').toUpperCase();
  const baseSymbol = String(symbol || '').replace(/USDT$/, '').trim().toUpperCase();

  if (!SIGNAL_SENTIMENT_ENABLED) {
    return {
      score: 0,
      directionalScore: 0,
      status: 'DISABLED',
      source: 'disabled',
      breakdown: {
        articleCount: 0,
        articleBias: 0,
        macroBias: 0,
        trend: trend || 'UNKNOWN'
      },
      label: 'NEUTRAL'
    };
  }

  const categories = baseSymbol ? `${baseSymbol},BTC,ETH` : 'BTC,ETH';
  try {
    const [articles, macroSnapshot] = await Promise.all([
      getNewsWithIntelligence(categories, SIGNAL_SENTIMENT_NEWS_LIMIT),
      getMacroTrendSnapshot()
    ]);

    const news = Array.isArray(articles) ? articles : [];
    const scoredArticles = news.map((article) => scoreArticle(article, baseSymbol));
    const articleBias = scoredArticles.length > 0
      ? scoredArticles.reduce((sum, value) => sum + value, 0) / scoredArticles.length
      : 0;
    const macroBias = deriveMacroBias(macroSnapshot, trend);
    const rawScore = clamp(articleBias + macroBias, -1, 1);
    const directionalScore = trend === 'SELL' ? clamp(-rawScore, -1, 1) : rawScore;

    return {
      score: rawScore,
      directionalScore,
      status: 'OK',
      source: news.some((article) => article?.intelligence?.source === 'groq_multi_agent')
        ? 'ai_news_macro'
        : 'news_macro_rules',
      breakdown: {
        articleCount: scoredArticles.length,
        articleBias: Number(articleBias.toFixed(4)),
        macroBias: Number(macroBias.toFixed(4)),
        trend: trend || 'UNKNOWN'
      },
      label: toSentimentSummary(rawScore)
    };
  } catch (error) {
    return {
      score: 0,
      directionalScore: 0,
      status: 'FALLBACK',
      source: 'fallback_neutral',
      error: error.message,
      breakdown: {
        articleCount: 0,
        articleBias: 0,
        macroBias: 0,
        trend: trend || 'UNKNOWN'
      },
      label: 'NEUTRAL'
    };
  }
}

function calculateSentimentAdjustment(directionalScore) {
  const value = Number(directionalScore);
  if (!Number.isFinite(value)) return 0;
  return clamp(Math.round(value * 6), -6, 6);
}

module.exports = {
  calcNewsSentiment,
  calculateSentimentAdjustment,
  scoreArticle,
  deriveMacroBias
};
