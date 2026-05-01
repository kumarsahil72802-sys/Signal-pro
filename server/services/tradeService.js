const Trade = require('../models/Trade');

/**
 * Save a minimal trade decision snapshot
 * @param {Object} data - Structured input data
 */
async function saveTradeSnapshot(data) {
  try {
    const tradeData = {
      c: data.coin,
      s: data.setup,
      t: Date.now(),
      r: data.rsi,
      v: data.volumeRatio,
      e: data.emaSlope,
      a: data.atrPct,
      b: data.btcMomentum,
      conf: data.confidence,
      ai: data.aiScore
    };

    const trade = await Trade.create(tradeData);
    console.log(`[TradeLogger] Saved snapshot for ${data.coin} (ID: ${trade._id})`);
    return trade;
  } catch (error) {
    console.error(`[TradeLogger] Error saving trade snapshot: ${error.message}`);
    return null;
  }
}

module.exports = {
  saveTradeSnapshot
};
