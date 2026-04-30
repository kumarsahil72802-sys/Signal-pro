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

/**
 * Update the result of an existing trade
 * @param {String} tradeId - MongoDB document ID
 * @param {String} result - WIN, LOSS, or EXPIRED
 */
async function updateTradeResult(tradeId, result) {
  try {
    const resultMap = {
      'WIN': 1,
      'LOSS': -1,
      'EXPIRED': 0
    };

    const numericResult = resultMap[result];
    
    if (numericResult === undefined) {
      throw new Error(`Invalid result type: ${result}`);
    }

    const updatedTrade = await Trade.findByIdAndUpdate(
      tradeId,
      { res: numericResult },
      { new: true }
    );

    if (!updatedTrade) {
      console.warn(`[TradeLogger] Trade not found for ID: ${tradeId}`);
      return null;
    }

    console.log(`[TradeLogger] Updated result for trade ${tradeId} to ${result} (${numericResult})`);
    return updatedTrade;
  } catch (error) {
    console.error(`[TradeLogger] Error updating trade result: ${error.message}`);
    return null;
  }
}

module.exports = {
  saveTradeSnapshot,
  updateTradeResult
};
