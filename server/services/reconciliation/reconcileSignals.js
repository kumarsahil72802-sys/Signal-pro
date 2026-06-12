const Signal = require('../../models/Signal');
const { logTrade } = require('../tradeLogger');
const { settings } = require('../signalEngine/config');
const { fetchReplayCandles } = require('./binanceReplay');
const { getMonitorCheckpointMs, setMonitorCheckpointMs } = require('./checkpointStore');
const {
  resolveSignalValidUntil,
  resolveReplayOutcome,
  normalizeAmbiguityPolicy
} = require('./outcomeResolver');

const {
  SIGNAL_REPLAY_INTERVAL,
  SIGNAL_REPLAY_KLINE_LIMIT,
  SIGNAL_REPLAY_MAX_GAP_HOURS,
  SIGNAL_REPLAY_AMBIGUITY_POLICY
} = settings;

const OUTCOME_CLEANUP_TTL_MS = 8 * 60 * 60 * 1000;

function resolveOutcomePrice(signal, outcomeResult) {
  if (!signal) return 0;
  if (outcomeResult === 'TARGET_HIT') return Number(signal.target) || Number(signal.entryPrice) || 0;
  if (outcomeResult === 'SL_HIT') return Number(signal.stopLoss) || Number(signal.entryPrice) || 0;
  return Number(signal.entryPrice) || 0;
}

async function applyReplayOutcome(signal, replayOutcome) {
  const hitAt = replayOutcome.hitAt instanceof Date ? replayOutcome.hitAt : new Date();

  if (signal.status === 'TAKEN') {
    const update = {
      status: 'CLOSED',
      result: replayOutcome.result,
      wasTaken: true,
      closedAt: hitAt,
      expireAt: new Date(hitAt.getTime() + OUTCOME_CLEANUP_TTL_MS)
    };

    await Signal.findByIdAndUpdate(signal._id, {
      ...update
    });

    const exitPrice = resolveOutcomePrice(signal, replayOutcome.result);
    await logTrade(signal, replayOutcome.result, exitPrice);
    return { closed: true, targetHit: replayOutcome.result === 'TARGET_HIT', expired: false };
  }

  if (signal.status === 'ACTIVE' && replayOutcome.result === 'TARGET_HIT') {
    const closedAt = hitAt;
    const expireAt = new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS);
    await Signal.findByIdAndUpdate(signal._id, {
      status: 'CLOSED',
      result: 'TARGET_HIT',
      isMissedOpportunity: true,
      missedAt: closedAt,
      expireAt,
      closedAt
    });
    return { closed: true, targetHit: true, expired: false };
  }

  if (signal.status === 'ACTIVE' && replayOutcome.result === 'SL_HIT') {
    const closedAt = hitAt;
    const expireAt = new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS);
    await Signal.findByIdAndUpdate(signal._id, {
      status: 'CLOSED',
      result: 'SL_HIT',
      closedAt,
      expireAt
    });
    return { closed: true, targetHit: false, expired: false };
  }

  if (signal.status === 'BLOCKED' && (replayOutcome.result === 'TARGET_HIT' || replayOutcome.result === 'SL_HIT')) {
    const closedAt = hitAt;
    const expireAt = new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS);
    const update = {
      status: 'CLOSED',
      result: replayOutcome.result,
      wasTaken: false,
      closedAt,
      expireAt,
      isMissedOpportunity: replayOutcome.result === 'TARGET_HIT'
    };

    if (replayOutcome.result === 'TARGET_HIT') {
      update.missedAt = closedAt;
    }

    await Signal.findByIdAndUpdate(signal._id, update);
    return { closed: true, targetHit: replayOutcome.result === 'TARGET_HIT', expired: false };
  }

  return { closed: false, targetHit: false, expired: false };
}

async function applyReplayExpiry(signal, validUntil) {
  const closedAt = validUntil instanceof Date ? validUntil : new Date();
  const expireAt = new Date(closedAt.getTime() + OUTCOME_CLEANUP_TTL_MS);
  const tookTrade = signal.status === 'TAKEN';

  await Signal.findByIdAndUpdate(signal._id, {
    status: 'CLOSED',
    result: 'EXPIRED',
    wasTaken: tookTrade,
    closedAt,
    expireAt
  });

  if (tookTrade) {
    await logTrade(signal, 'EXPIRED', Number(signal.entryPrice) || 0);
  }

  return { closed: true, targetHit: false, expired: true };
}

async function reconcileSignalsForDowntime(nowMs = Date.now()) {
  const summary = {
    initialized: false,
    replayAttempted: false,
    checkpointUpdated: false,
    windowStartMs: null,
    windowEndMs: nowMs,
    gapMs: 0,
    clampedGap: false,
    unresolvedScanned: 0,
    reconciledSignals: 0,
    closedCount: 0,
    targetHitCount: 0,
    expiredCount: 0,
    ambiguousCount: 0,
    failedSignals: 0,
    candlesFetched: 0,
    reason: 'ok'
  };

  const checkpointMs = await getMonitorCheckpointMs();
  if (!checkpointMs) {
    await setMonitorCheckpointMs(nowMs);
    summary.initialized = true;
    summary.checkpointUpdated = true;
    summary.reason = 'checkpoint_initialized';
    return summary;
  }

  const maxGapMs = Math.max(1, SIGNAL_REPLAY_MAX_GAP_HOURS) * 60 * 60 * 1000;
  let windowStartMs = checkpointMs;
  if (nowMs - checkpointMs > maxGapMs) {
    windowStartMs = nowMs - maxGapMs;
    summary.clampedGap = true;
  }

  summary.windowStartMs = windowStartMs;
  summary.gapMs = Math.max(0, nowMs - windowStartMs);

  if (summary.gapMs <= 0) {
    await setMonitorCheckpointMs(nowMs);
    summary.checkpointUpdated = true;
    summary.reason = 'no_gap';
    return summary;
  }

  summary.replayAttempted = true;

  const unresolvedSignals = await Signal.find({
    status: { $in: ['ACTIVE', 'TAKEN', 'BLOCKED'] },
    createdAt: { $lte: new Date(nowMs) }
  }).sort({ createdAt: 1 });

  summary.unresolvedScanned = unresolvedSignals.length;
  if (unresolvedSignals.length === 0) {
    await setMonitorCheckpointMs(nowMs);
    summary.checkpointUpdated = true;
    summary.reason = 'no_unresolved_signals';
    return summary;
  }

  const ambiguityPolicy = normalizeAmbiguityPolicy(SIGNAL_REPLAY_AMBIGUITY_POLICY);
  let hadFailures = false;

  for (const signal of unresolvedSignals) {
    try {
      const createdAtMs = new Date(signal.createdAt).getTime();
      if (!Number.isFinite(createdAtMs)) continue;

      const validUntil = resolveSignalValidUntil(signal);
      if (!signal.validUntil && validUntil) {
        signal.validUntil = validUntil;
        await Signal.findByIdAndUpdate(signal._id, { validUntil });
      }

      const replayStartMs = Math.max(nowMs - maxGapMs, createdAtMs);
      const replayEndMs = validUntil
        ? Math.min(nowMs, validUntil.getTime())
        : nowMs;

      let replayOutcome = {
        resolved: false,
        result: null,
        hitAt: null,
        reason: 'no_replay_window',
        ambiguousCount: 0
      };

      if (replayEndMs > replayStartMs) {
        const candles = await fetchReplayCandles(signal.coin, replayStartMs, replayEndMs, {
          interval: SIGNAL_REPLAY_INTERVAL,
          limit: SIGNAL_REPLAY_KLINE_LIMIT
        });
        summary.candlesFetched += candles.length;
        replayOutcome = resolveReplayOutcome(signal, candles, { ambiguityPolicy });
        summary.ambiguousCount += replayOutcome.ambiguousCount || 0;
      }

      if (replayOutcome.resolved) {
        const outcome = await applyReplayOutcome(signal, replayOutcome);
        summary.reconciledSignals += 1;
        if (outcome.closed) summary.closedCount += 1;
        if (outcome.targetHit) summary.targetHitCount += 1;
        if (outcome.expired) summary.expiredCount += 1;
        continue;
      }

      if (signal.status !== 'BLOCKED' && validUntil && nowMs >= validUntil.getTime()) {
        const outcome = await applyReplayExpiry(signal, validUntil);
        summary.reconciledSignals += 1;
        if (outcome.closed) summary.closedCount += 1;
        if (outcome.targetHit) summary.targetHitCount += 1;
        if (outcome.expired) summary.expiredCount += 1;
      }
    } catch (error) {
      hadFailures = true;
      summary.failedSignals += 1;
      console.error(`[Reconcile] ${signal.coin} replay failed: ${error.message}`);
    }
  }

  if (!hadFailures) {
    await setMonitorCheckpointMs(nowMs);
    summary.checkpointUpdated = true;
    summary.reason = 'replay_complete';
  } else {
    summary.reason = 'replay_partial_failures';
  }

  return summary;
}

module.exports = {
  reconcileSignalsForDowntime
};
