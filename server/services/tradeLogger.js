const TradeLog = require('../models/TradeLog');

async function logTrade(signal, result, exitPrice) {
  try {
    const trade = new TradeLog({
      symbol: signal.coin,
      type: signal.type,
      entryPrice: signal.entryPrice,
      exitPrice,
      result,
      confidence: signal.confidence,
      aiScore: signal.aiScore,
      regime: signal.regime,
      trigger: signal.trigger
    });
    await trade.save();
    console.log(`[TRADE] Logged ${signal.coin} ${signal.type} → ${result}`);
  } catch (error) {
    console.error(`[TRADE] Failed to log trade: ${error.message}`);
  }
}

async function cleanOldLogs() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await TradeLog.deleteMany({ createdAt: { $lt: cutoff } });
    console.log(`[CLEANUP] Deleted ${result.deletedCount} old trade logs`);
    return result.deletedCount;
  } catch (error) {
    console.error(`[CLEANUP] Failed to clean logs: ${error.message}`);
    return 0;
  }
}

module.exports = { logTrade, cleanOldLogs };
