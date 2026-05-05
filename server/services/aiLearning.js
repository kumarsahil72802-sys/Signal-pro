const TradeLog = require('../models/TradeLog');

const PERFORMANCE_WINDOW = Math.max(20, Number(process.env.AI_LEARNING_WINDOW || 300));

async function analyzePerformance() {
  try {
    const logs = await TradeLog.find({
      result: { $in: ['TARGET_HIT', 'SL_HIT'] }
    })
      .sort({ createdAt: -1 })
      .limit(PERFORMANCE_WINDOW)
      .lean();

    if (logs.length < 20) return null;

    const triggerStats = {};
    const triggerSymbolStats = {};
    let wins = 0;

    for (const log of logs) {
      const isWin = log.result === 'TARGET_HIT';
      if (isWin) wins++;

      const triggerKey = String(log.trigger || 'UNKNOWN').toUpperCase();
      const symbolKey = String(log.symbol || 'UNKNOWN').toUpperCase();

      if (!triggerStats[triggerKey]) {
        triggerStats[triggerKey] = { win: 0, loss: 0 };
      }
      if (isWin) {
        triggerStats[triggerKey].win++;
      } else {
        triggerStats[triggerKey].loss++;
      }

      if (!triggerSymbolStats[triggerKey]) {
        triggerSymbolStats[triggerKey] = {};
      }
      if (!triggerSymbolStats[triggerKey][symbolKey]) {
        triggerSymbolStats[triggerKey][symbolKey] = { win: 0, loss: 0 };
      }

      if (isWin) {
        triggerSymbolStats[triggerKey][symbolKey].win++;
      } else {
        triggerSymbolStats[triggerKey][symbolKey].loss++;
      }
    }

    return {
      winRate: Math.round((wins / logs.length) * 100),
      triggerStats,
      triggerSymbolStats,
      sampleSize: logs.length
    };
  } catch (error) {
    console.error(`[AI Learning] Analysis failed: ${error.message}`);
    return null;
  }
}

module.exports = { analyzePerformance };
