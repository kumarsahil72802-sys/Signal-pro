const TradeLog = require('../models/TradeLog');
const { resolveConfidenceBand } = require('./aiLearning');

async function logTrade(signal, result, exitPrice) {
  try {
    const trade = new TradeLog({
      symbol: signal.coin,
      type: signal.type,
      entryPrice: signal.entryPrice,
      exitPrice,
      result,
      confidence: signal.confidence,
      confidenceBand: resolveConfidenceBand(signal.confidence),
      aiScore: signal.aiScore,
      regime: signal.regime,
      trigger: signal.trigger,
      segmentKey: signal.segmentKey || null,
      machineVersion: signal.machineVersion || null
    });
    await trade.save();
    console.log(`[TRADE] Logged ${signal.coin} ${signal.type} → ${result}`);
  } catch (error) {
    console.error(`[TRADE] Failed to log trade: ${error.message}`);
  }
}

module.exports = { logTrade };
