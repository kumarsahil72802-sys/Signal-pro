const TradeLog = require('../models/TradeLog');

async function analyzePerformance() {
  try {
    const logs = await TradeLog.find().lean();
    if (logs.length < 20) return null;

    const triggerStats = {};
    let wins = 0;

    for (const log of logs) {
      const isWin = log.result === 'TARGET_HIT';
      if (isWin) wins++;

      if (!triggerStats[log.trigger]) {
        triggerStats[log.trigger] = { win: 0, loss: 0 };
      }
      if (isWin) {
        triggerStats[log.trigger].win++;
      } else {
        triggerStats[log.trigger].loss++;
      }
    }

    return {
      winRate: Math.round((wins / logs.length) * 100),
      triggerStats
    };
  } catch (error) {
    console.error(`[AI Learning] Analysis failed: ${error.message}`);
    return null;
  }
}

module.exports = { analyzePerformance };
