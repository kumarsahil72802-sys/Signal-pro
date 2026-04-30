const { getLivePrice, getBatchPrices } = require('./binanceService');
const Signal = require('../models/Signal');

// 8 hours TTL for missed opportunities
const MISSED_OPPORTUNITY_TTL_MS = 8 * 60 * 60 * 1000;

// Monitor status for health endpoint
let monitorRunning = false;
let lastMonitorRun = null;

/**
 * Check if price hit target for a signal
 */
function isTargetHit(signal, livePrice) {
  return (signal.type === 'BUY' && livePrice >= signal.target) ||
         (signal.type === 'SELL' && livePrice <= signal.target);
}

/**
 * Check if price hit stop loss for a signal
 */
function isStopLossHit(signal, livePrice) {
  return (signal.type === 'BUY' && livePrice <= signal.stopLoss) ||
         (signal.type === 'SELL' && livePrice >= signal.stopLoss);
}

/**
 * Process a TAKEN signal that hit target or stop loss
 * → Mark as CLOSED (this is a real win or loss, not a missed opportunity)
 */
async function processTakenSignal(signal, livePrice, result) {
  const label = result === 'TARGET_HIT' ? 'Target hit' : 'Stop loss hit';
  console.log(`[MONITOR] ${signal.coin} ${label} at ${livePrice} -> CLOSED`);

  // Mark as CLOSED and track that it was taken (for proper win rate calculation)
  await Signal.findByIdAndUpdate(signal._id, {
    status: 'CLOSED',
    result,
    wasTaken: true,  // Flag to distinguish TAKEN→CLOSED from ACTIVE→CLOSED
    closedAt: new Date()
  });

  return { closed: true, missed: false };
}

/**
 * Process an ACTIVE (not taken) signal that hit target
 * → Mark as MISSED OPPORTUNITY (not a loss)
 */
async function processMissedOpportunity(signal, livePrice) {
  console.log(`[MONITOR] ${signal.coin} Target hit at ${livePrice} (not taken) -> MISSED OPPORTUNITY`);

  const missedAt = new Date();
  const expireAt = new Date(missedAt.getTime() + MISSED_OPPORTUNITY_TTL_MS);

  await Signal.findByIdAndUpdate(signal._id, {
    status: 'MISSED',
    result: 'TARGET_HIT',
    isMissedOpportunity: true,
    missedAt,
    expireAt,
    closedAt: missedAt
  });

  return { closed: false, missed: true };
}

/**
 * Process an ACTIVE (not taken) signal that hit stop loss
 * → Mark as CLOSED (loss, not a missed opportunity)
 */
async function processUnTakenStopLoss(signal, livePrice) {
  console.log(`[MONITOR] ${signal.coin} Stop loss hit at ${livePrice} (not taken) -> CLOSED`);

  await Signal.findByIdAndUpdate(signal._id, {
    status: 'CLOSED',
    result: 'SL_HIT',
    closedAt: new Date()
  });

  return { closed: true, missed: false };
}

async function monitorSignals() {
  try {
    console.log('[MONITOR] Checking active signals...');
    lastMonitorRun = new Date();

    // Fetch ACTIVE and TAKEN signals only (MISSED and CLOSED are final states)
    const signals = await Signal.find({
      status: { $in: ['ACTIVE', 'TAKEN'] }
    });

    if (signals.length === 0) {
      console.log('[MONITOR] No active signals to monitor.');
      return;
    }

    const uniqueCoins = [...new Set(signals.map(s => s.coin))];

    // Fetch live prices
    let prices = {};
    try {
      prices = await getBatchPrices(uniqueCoins);
    } catch (batchError) {
      console.log(`[MONITOR] Batch fetch failed, falling back to individual: ${batchError.message}`);
      for (const coin of uniqueCoins) {
        try {
          prices[coin] = await getLivePrice(coin);
        } catch (err) {
          console.error(`[MONITOR] Failed to fetch price for ${coin}: ${err.message}`);
        }
      }
    }

    let closedCount = 0;
    let missedCount = 0;
    const processedIds = new Set(); // Prevent duplicate processing

    for (const signal of signals) {
      // Skip if already processed (safety check)
      if (processedIds.has(signal._id.toString())) continue;

      const livePrice = prices[signal.coin];
      if (livePrice == null) continue;

      let result = null;

      // Check target hit
      if (isTargetHit(signal, livePrice)) {
        result = 'TARGET_HIT';
      }
      // Check stop loss hit
      else if (isStopLossHit(signal, livePrice)) {
        result = 'SL_HIT';
      }

      if (result) {
        let outcome;

        if (signal.status === 'TAKEN') {
          // User took the trade - mark as closed regardless of outcome
          outcome = await processTakenSignal(signal, livePrice, result);
        } else if (signal.status === 'ACTIVE') {
          // User did NOT take the trade
          if (result === 'TARGET_HIT') {
            // Target hit without taking = missed opportunity
            outcome = await processMissedOpportunity(signal, livePrice);
          } else {
            // SL hit without taking = just close (not a missed opportunity, it was a loss)
            outcome = await processUnTakenStopLoss(signal, livePrice);
          }
        }

        if (outcome.closed) closedCount++;
        if (outcome.missed) missedCount++;
        processedIds.add(signal._id.toString());
      }
    }

    console.log(`[MONITOR] Checked ${signals.length} signals, closed ${closedCount}, missed ${missedCount}.`);
  } catch (error) {
    console.error('[MONITOR] Error:', error.message);
  }
}

function startSignalMonitor() {
  monitorRunning = true;
  monitorSignals();
  setInterval(monitorSignals, 5 * 60 * 1000);
  console.log('[MONITOR] Started. Running every 5 minutes.');
}

/**
 * Get monitor health status
 */
function getMonitorStatus() {
  if (!monitorRunning) return "stopped";
  if (!lastMonitorRun) return "starting";

  const minutesSinceLastRun = (Date.now() - lastMonitorRun.getTime()) / 60000;
  if (minutesSinceLastRun > 10) return "stalled";
  return "running";
}

module.exports = { startSignalMonitor, monitorSignals, getMonitorStatus };
