const cron = require('node-cron');
const { performTradeCleanup } = require('./cleanupService');

/**
 * Initialize all scheduled tasks
 */
function initScheduler() {
  console.log('[Scheduler] Initializing background tasks...');

  // Run trade log cleanup every hour
  // Pattern: 0 * * * * (At minute 0 of every hour)
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Executing hourly trade cleanup job...');
    await performTradeCleanup();
  });

  // Also run once on startup
  performTradeCleanup();

  console.log('[Scheduler] Hourly cleanup job scheduled.');
}

module.exports = {
  initScheduler
};
