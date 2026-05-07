const { getNews } = require('../../cryptoCompareService');
const { askGroq } = require('../../groqService');

async function calcNewsSentiment(symbol) {
  try {
    const baseSymbol = symbol.replace('USDT', '');
    const articles = await getNews(baseSymbol, 5);
    if (!articles || articles.length === 0) return 0;

    const headlines = articles
      .map((article) => article.title)
      .filter(Boolean)
      .slice(0, 5)
      .join('\n');

    const prompt = `Crypto sentiment analyzer. Headlines for ${baseSymbol}:\n${headlines}\n\nReply ONLY with a number -1.0 to 1.0. No explanation.`;
    const result = await askGroq(prompt, '0');
    const score = parseFloat(result);

    return Number.isNaN(score) ? 0 : Math.max(-1, Math.min(1, score));
  } catch {
    return 0;
  }
}

module.exports = {
  calcNewsSentiment
};
