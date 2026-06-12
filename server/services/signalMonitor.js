const { getLivePrice, getBatchPrices } = require('./binanceService');
const Signal = require('../models/Signal');
const { logTrade } = require('./tradeLogger');
const { reconcileSignalsForDowntime } = require('./reconciliation/reconcileSignals');
const { settings } = require('./signalEngine/config');

// 8 hours cleanup TTL for short-lived outcomes shown in UI
const OUTCOME_CLEANUP_TTL_MS = 8 * 60 * 60 * 1000;
const {
  SIGNAL_VALIDITY_MS,
  SIGNAL_RECONCILE_ON_MONITOR,
  SIGNAL_MONITOR_INTERVAL_MS,
  SIGNAL_RECONCILE_MIN_INTERVAL_MS,
  SIGNAL_MONITOR_MAX_SIGNALS_PER_TICK
} = settings;

// Monitor status for health endpoint
let monitorRunning = false;
let lastMonitorRun = null;
let lastReconcileRunAt = 0;
let monitorTickInProgress = false;

function isTargetHit(signal, livePrice) {
  return (signal.type === 'BUY' && livePrice >= signal.target) ||
         (signal.type === 'SELL' && livePrice <= signal.target);
}

function isStopLossHit(signal, livePrice) {
  return (signal.type === 'BUY' && livePrice <= signal.stopLoss) ||
         (signal.type === 'SELL' && livePrice >= signal.stopLoss);
}

function hasSignalExpired(signal, nowMs) {
  const validUntil = resolveSignalValidUntil(signal);
  if (!validUntil) return false;
  const validUntilMs = validUntil.getTime();
  if (!Number.isFinite(validUntilMs)) return false;
  return nowMs >= validUntilMs;
}

function resolveSignalValidUntil(signal) {
  if (!signal) return null;
  if (signal.validUntil) {
    const ts = new Date(signal.validUntil).getTime();
    if (Number.isFinite(ts)) return new Date(ts);
  }

  if (!signal.createdAt) return null;
  const createdTs = new Date(signal.createdAt).getTime();
  if (!Number.isFinite(createdTs)) return null;
  return new Date(createdTs + SIGNAL_VALIDITY_MS);
}

async function ensureSignalValidityWindow(signal) {
  if (!signal || signal.validUntil) return;
  const resolvedValidUntil = resolveSignalValidUntil(signal);
  if (!resolvedValidUntil) return;

  signal.validUntil = resolvedValidUntil;
  await Signal.findByIdAndUpdate(signal._id, {
    validUntil: resolvedValidUntil
  });
}

async function processTakenSignal(signal, livePrice, result) {
  const label = result === 'TARGET_HIT' ? 'Target hit' : 'Stop loss hit';
  console.log(`[MONITOR] ${signal.coin} ${label} at ${livePrice} -> CLOSED`);

  const closedAt = new Date();
  const update = {
    status: 'CLOSED',
    result,
    wasTaken: true,
    closedAt,
    expireAt: new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS)
  };

  await Signal.findByIdAndUpdate(signal._id, update);

  await logTrade(signal, result, livePrice);
  return { closed: true, targetHit: result === 'TARGET_HIT', expired: false };
}

async function processUntakenTargetHit(signal, livePrice) {
  console.log(`[MONITOR] ${signal.coin} Target hit at ${livePrice} (not taken) -> CLOSED TARGET_HIT`);

  const closedAt = new Date();
  const expireAt = new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS);

  await Signal.findByIdAndUpdate(signal._id, {
    status: 'CLOSED',
    result: 'TARGET_HIT',
    isMissedOpportunity: true,
    missedAt: closedAt,
    closedAt,
    expireAt
  });

  return { closed: true, targetHit: true, expired: false };
}

async function processUnTakenStopLoss(signal, livePrice) {
  console.log(`[MONITOR] ${signal.coin} Stop loss hit at ${livePrice} (not taken) -> CLOSED`);

  const closedAt = new Date();
  const expireAt = new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS);

  await Signal.findByIdAndUpdate(signal._id, {
    status: 'CLOSED',
    result: 'SL_HIT',
    closedAt,
    expireAt
  });

  return { closed: true, targetHit: false, expired: false };
}

async function processBlockedSignalOutcome(signal, livePrice, result) {
  const label = result === 'TARGET_HIT' ? 'Target hit' : 'Stop loss hit';
  console.log(`[MONITOR] ${signal.coin} ${label} at ${livePrice} (blocked) -> CLOSED`);

  const closedAt = new Date();
  const expireAt = new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS);

  const update = {
    status: 'CLOSED',
    result,
    wasTaken: false,
    closedAt,
    expireAt,
    isMissedOpportunity: result === 'TARGET_HIT'
  };

  if (result === 'TARGET_HIT') {
    update.missedAt = closedAt;
  }

  await Signal.findByIdAndUpdate(signal._id, update);
  return { closed: true, targetHit: result === 'TARGET_HIT', expired: false };
}

async function processExpiredSignal(signal, livePrice = null) {
  const now = new Date();
  const expireAt = new Date(now.getTime() + OUTCOME_CLEANUP_TTL_MS);
  const resolutionPrice = Number.isFinite(Number(livePrice))
    ? Number(livePrice)
    : Number(signal.entryPrice);
  const tookTrade = signal.status === 'TAKEN';
  console.log(`[MONITOR] ${signal.coin} validity expired -> CLOSED (status:${signal.status})`);

  await Signal.findByIdAndUpdate(signal._id, {
    status: 'CLOSED',
    result: 'EXPIRED',
    wasTaken: tookTrade,
    closedAt: now,
    expireAt
  });

  if (tookTrade) {
    await logTrade(signal, 'EXPIRED', resolutionPrice);
  }

  return { closed: true, targetHit: false, expired: true };
}

async function fetchPricesForCoins(coins) {
  if (!Array.isArray(coins) || coins.length === 0) return {};

  try {
    return await getBatchPrices(coins);
  } catch (batchError) {
    console.log(`[MONITOR] Batch fetch failed, falling back to individual: ${batchError.message}`);
    const prices = {};
    for (const coin of coins) {
      try {
        prices[coin] = await getLivePrice(coin);
      } catch (error) {
        console.error(`[MONITOR] Failed to fetch price for ${coin}: ${error.message}`);
      }
    }
    return prices;
  }
}

async function monitorSignals() {
  if (monitorTickInProgress) {
    console.log('[MONITOR] Previous check still running. Skipping overlapping tick.');
    return;
  }

  monitorTickInProgress = true;
  try {
    console.log('[MONITOR] Checking unresolved signals...');
    lastMonitorRun = new Date();
    const nowMs = Date.now();

    if (SIGNAL_RECONCILE_ON_MONITOR) {
      const elapsedSinceReconcile = nowMs - lastReconcileRunAt;
      const shouldRunReconcile = !lastReconcileRunAt || elapsedSinceReconcile >= SIGNAL_RECONCILE_MIN_INTERVAL_MS;

      if (shouldRunReconcile) {
        try {
          const replaySummary = await reconcileSignalsForDowntime(nowMs);
          lastReconcileRunAt = nowMs;
          if (replaySummary.replayAttempted || replaySummary.initialized) {
            console.log(
              `[MONITOR][REPLAY] reason:${replaySummary.reason} | gapMin:${(replaySummary.gapMs / 60000).toFixed(1)} | ` +
              `scanned:${replaySummary.unresolvedScanned} | reconciled:${replaySummary.reconciledSignals} | ` +
              `closed:${replaySummary.closedCount} | targetHit:${replaySummary.targetHitCount} | expired:${replaySummary.expiredCount} | ` +
              `ambiguous:${replaySummary.ambiguousCount} | failed:${replaySummary.failedSignals} | checkpointUpdated:${replaySummary.checkpointUpdated ? 'YES' : 'NO'}`
            );
          }
        } catch (replayError) {
          // Keep monitor pass alive even if replay/checkpoint storage fails.
          console.error(`[MONITOR][REPLAY] failed: ${replayError.message}`);
        }
      } else {
        const remainingMs = SIGNAL_RECONCILE_MIN_INTERVAL_MS - elapsedSinceReconcile;
        console.log(`[MONITOR][REPLAY] skipped (cooldown ${Math.ceil(remainingMs / 1000)}s remaining)`);
      }
    }

    const signals = await Signal.find({
      status: { $in: ['ACTIVE', 'TAKEN', 'BLOCKED'] }
    })
      .sort({ createdAt: 1 })
      .limit(SIGNAL_MONITOR_MAX_SIGNALS_PER_TICK);

    if (signals.length === 0) {
      console.log('[MONITOR] No unresolved signals to monitor.');
      return;
    }

    let closedCount = 0;
    let targetHitCount = 0;
    let expiredCount = 0;
    const processedIds = new Set();
    // Pass 1: time-based expiry (ACTIVE/TAKEN only).
    for (const signal of signals) {
      if (signal.status === 'BLOCKED') continue;
      await ensureSignalValidityWindow(signal);
      const id = signal._id.toString();
      if (processedIds.has(id)) continue;
      if (!hasSignalExpired(signal, nowMs)) continue;

      const outcome = await processExpiredSignal(signal);
      if (outcome.closed) closedCount++;
      if (outcome.expired) expiredCount++;
      processedIds.add(id);
    }

    const remainingSignals = signals.filter((signal) => !processedIds.has(signal._id.toString()));
    if (remainingSignals.length === 0) {
      console.log(`[MONITOR] Checked ${signals.length} signals, closed ${closedCount}, targetHit ${targetHitCount}, expired ${expiredCount}.`);
      return;
    }

    const uniqueCoins = [...new Set(remainingSignals.map((signal) => signal.coin))];
    const prices = await fetchPricesForCoins(uniqueCoins);

    // Pass 2: price-based resolution for still-valid signals.
    for (const signal of remainingSignals) {
      const id = signal._id.toString();
      if (processedIds.has(id)) continue;

      const livePrice = prices[signal.coin];
      if (livePrice == null) continue;

      let result = null;
      if (isTargetHit(signal, livePrice)) {
        result = 'TARGET_HIT';
      } else if (isStopLossHit(signal, livePrice)) {
        result = 'SL_HIT';
      }

      if (!result) continue;

      let outcome = null;
      if (signal.status === 'TAKEN') {
        outcome = await processTakenSignal(signal, livePrice, result);
      } else if (signal.status === 'ACTIVE') {
        if (result === 'TARGET_HIT') {
          outcome = await processUntakenTargetHit(signal, livePrice);
        } else {
          outcome = await processUnTakenStopLoss(signal, livePrice);
        }
      } else if (signal.status === 'BLOCKED') {
        outcome = await processBlockedSignalOutcome(signal, livePrice, result);
      }

      if (!outcome) continue;
      if (outcome.closed) closedCount++;
      if (outcome.targetHit) targetHitCount++;
      if (outcome.expired) expiredCount++;
      processedIds.add(id);
    }

    console.log(`[MONITOR] Checked ${signals.length} signals, closed ${closedCount}, targetHit ${targetHitCount}, expired ${expiredCount}.`);
  } catch (error) {
    console.error('[MONITOR] Error:', error.message);
  } finally {
    monitorTickInProgress = false;
  }
}

function startSignalMonitor() {
  monitorRunning = true;
  monitorSignals();
  setInterval(monitorSignals, SIGNAL_MONITOR_INTERVAL_MS);
  console.log(
    `[MONITOR] Started. Tick:${Math.round(SIGNAL_MONITOR_INTERVAL_MS / 1000)}s | ReplayCooldown:${Math.round(SIGNAL_RECONCILE_MIN_INTERVAL_MS / 1000)}s.`
  );
}

function getMonitorStatus() {
  if (!monitorRunning) return 'stopped';
  if (!lastMonitorRun) return 'starting';

  const minutesSinceLastRun = (Date.now() - lastMonitorRun.getTime()) / 60000;
  if (minutesSinceLastRun > 10) return 'stalled';
  return 'running';
}

module.exports = {
  startSignalMonitor,
  getMonitorStatus,
  isTargetHit,
  isStopLossHit
};
