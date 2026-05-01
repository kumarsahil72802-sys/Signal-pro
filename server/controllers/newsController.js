const { getNews } = require('../services/cryptoCompareService');

function parseSymbol(rawSymbol) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!symbol) return null;
  return /^[A-Z0-9]{2,10}$/.test(symbol) ? symbol : null;
}

function parseLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(3, Math.min(20, Math.round(parsed)));
}

const getCryptoNews = async (req, res) => {
  try {
    const symbol = parseSymbol(req.query.symbol);
    const limit = parseLimit(req.query.limit);
    const categories = symbol ? `${symbol},BTC,ETH` : 'BTC,ETH';
    const news = await getNews(categories, limit);
    res.json(news);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getCryptoNews };
