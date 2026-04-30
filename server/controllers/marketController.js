const { getTopCoins } = require('../services/coingeckoService');

const getMarketOverview = async (req, res) => {
  try {
    const coins = await getTopCoins();
    res.json(coins);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getMarketOverview };
