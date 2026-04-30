const Trade = require('../models/Trade');

/**
 * Cleanup System - Keeps MongoDB storage within limits
 * Strategies:
 * 1. Time-based: Delete trades older than 30 days
 * 2. Limit-based: Keep only latest 5000 trades
 */
async function performTradeCleanup() {
  console.log('[Cleanup] Starting trade log cleanup...');
  
  try {
    // Strategy A: Time-based cleanup (30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const timeDeleted = await Trade.deleteMany({ t: { $lt: thirtyDaysAgo } });
    if (timeDeleted.deletedCount > 0) {
      console.log(`[Cleanup] Strategy A: Deleted ${timeDeleted.deletedCount} trades older than 30 days.`);
    }

    // Strategy B: Limit-based cleanup (Keep only latest 5000)
    const MAX_TRADES = 5000;
    const totalCount = await Trade.countDocuments();
    
    if (totalCount > MAX_TRADES) {
      const overLimit = totalCount - MAX_TRADES;
      
      // Find the ID of the 5000th newest trade
      const thresholdTrade = await Trade.find()
        .sort({ t: -1 })
        .skip(MAX_TRADES - 1)
        .limit(1)
        .select('t');

      if (thresholdTrade.length > 0) {
        const thresholdTimestamp = thresholdTrade[0].t;
        
        // Delete everything older than that timestamp
        const limitDeleted = await Trade.deleteMany({ t: { $lt: thresholdTimestamp } });
        console.log(`[Cleanup] Strategy B: Database exceeded ${MAX_TRADES} records. Deleted oldest ${limitDeleted.deletedCount} trades.`);
      }
    }

    console.log('[Cleanup] Trade cleanup completed successfully.');
  } catch (error) {
    console.error(`[Cleanup] Error during trade cleanup: ${error.message}`);
  }
}

module.exports = {
  performTradeCleanup
};
