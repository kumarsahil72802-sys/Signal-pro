const { getNews } = require('../services/cryptoCompareService');

const getCryptoNews = async (req, res) => {
  try {
    const news = await getNews();
    res.json(news);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getCryptoNews };
