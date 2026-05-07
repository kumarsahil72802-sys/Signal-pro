const TradeLog = require('../models/TradeLog');
const { settings } = require('./signalEngine/config');

const PERFORMANCE_WINDOW = Math.max(20, Number(process.env.AI_LEARNING_WINDOW || 300));
const PERFORMANCE_CACHE_TTL_MS = Math.max(30 * 1000, Number(process.env.AI_LEARNING_CACHE_TTL_MS || 2 * 60 * 1000));

const {
  SIGNAL_SEGMENT_MIN_SAMPLE,
  SIGNAL_SEGMENT_COOLDOWN_MINUTES
} = settings;

let cachedPerformance = null;
let cachedPerformanceUntil = 0;
const segmentCooldownMap = new Map();

function nowMs() {
  return Date.now();
}

function resolveConfidenceBand(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value >= 75) return 'HIGH';
  if (value >= 60) return 'MID';
  if (value >= 50) return 'LOW';
  return 'VERY_LOW';
}

function buildSegmentKey({ trigger, regime, symbol, confidence }) {
  const triggerKey = String(trigger || 'UNKNOWN').toUpperCase();
  const regimeKey = String(regime || 'UNKNOWN').toUpperCase();
  const symbolKey = String(symbol || 'UNKNOWN').toUpperCase();
  const band = resolveConfidenceBand(confidence);
  return `${triggerKey}|${regimeKey}|${symbolKey}|${band}`;
}

function getSegmentHealthSummary(segmentStats = {}) {
  const items = Object.entries(segmentStats)
    .map(([segmentKey, stat]) => {
      const total = Number(stat?.total || 0);
      const win = Number(stat?.win || 0);
      const loss = Number(stat?.loss || 0);
      const winRate = total > 0 ? (win / total) * 100 : 0;
      return {
        segmentKey,
        total,
        win,
        loss,
        winRate: Math.round(winRate * 10) / 10
      };
    })
    .filter((item) => item.total >= SIGNAL_SEGMENT_MIN_SAMPLE)
    .sort((a, b) => b.total - a.total);

  const weakSegments = items
    .filter((item) => item.winRate < 40)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 5);
  const strongSegments = items
    .filter((item) => item.winRate > 65)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 5);

  const activeCooldowns = [...segmentCooldownMap.entries()]
    .filter(([, expiry]) => Number(expiry) > nowMs())
    .map(([segmentKey, expiry]) => ({
      segmentKey,
      cooldownUntil: new Date(expiry).toISOString()
    }))
    .slice(0, 20);

  return {
    minSample: SIGNAL_SEGMENT_MIN_SAMPLE,
    activeSegments: items.length,
    weakSegments,
    strongSegments,
    activeCooldowns
  };
}

function applySegmentCooldownRules(segmentStats) {
  const now = nowMs();
  const cooldownMs = SIGNAL_SEGMENT_COOLDOWN_MINUTES * 60 * 1000;

  for (const [segmentKey, stat] of Object.entries(segmentStats || {})) {
    const total = Number(stat?.total || 0);
    if (total < SIGNAL_SEGMENT_MIN_SAMPLE) continue;

    const win = Number(stat?.win || 0);
    const winRate = total > 0 ? (win / total) * 100 : 0;
    if (winRate <= 35) {
      segmentCooldownMap.set(segmentKey, now + cooldownMs);
    }
  }

  for (const [segmentKey, expiry] of segmentCooldownMap.entries()) {
    if (expiry <= now) {
      segmentCooldownMap.delete(segmentKey);
    }
  }
}

async function analyzePerformance(options = {}) {
  try {
    const forceRefresh = options.forceRefresh === true;
    const now = nowMs();
    if (!forceRefresh && cachedPerformance && now < cachedPerformanceUntil) {
      return cachedPerformance;
    }

    const logs = await TradeLog.find({
      result: { $in: ['TARGET_HIT', 'SL_HIT'] }
    })
      .sort({ createdAt: -1 })
      .limit(PERFORMANCE_WINDOW)
      .lean();

    if (logs.length < 20) {
      cachedPerformance = null;
      cachedPerformanceUntil = now + PERFORMANCE_CACHE_TTL_MS;
      return null;
    }

    const triggerStats = {};
    const triggerSymbolStats = {};
    const segmentStats = {};
    let wins = 0;

    for (const log of logs) {
      const isWin = log.result === 'TARGET_HIT';
      if (isWin) wins++;

      const triggerKey = String(log.trigger || 'UNKNOWN').toUpperCase();
      const symbolKey = String(log.symbol || 'UNKNOWN').toUpperCase();
      const regimeKey = String(log.regime || 'UNKNOWN').toUpperCase();
      const segmentKey = buildSegmentKey({
        trigger: triggerKey,
        regime: regimeKey,
        symbol: symbolKey,
        confidence: log.confidence
      });

      if (!triggerStats[triggerKey]) {
        triggerStats[triggerKey] = { win: 0, loss: 0 };
      }
      if (!triggerSymbolStats[triggerKey]) {
        triggerSymbolStats[triggerKey] = {};
      }
      if (!triggerSymbolStats[triggerKey][symbolKey]) {
        triggerSymbolStats[triggerKey][symbolKey] = { win: 0, loss: 0 };
      }
      if (!segmentStats[segmentKey]) {
        segmentStats[segmentKey] = { win: 0, loss: 0, total: 0 };
      }

      if (isWin) {
        triggerStats[triggerKey].win++;
        triggerSymbolStats[triggerKey][symbolKey].win++;
        segmentStats[segmentKey].win++;
      } else {
        triggerStats[triggerKey].loss++;
        triggerSymbolStats[triggerKey][symbolKey].loss++;
        segmentStats[segmentKey].loss++;
      }

      segmentStats[segmentKey].total += 1;
    }

    applySegmentCooldownRules(segmentStats);
    const segmentHealthSummary = getSegmentHealthSummary(segmentStats);

    cachedPerformance = {
      winRate: Math.round((wins / logs.length) * 100),
      triggerStats,
      triggerSymbolStats,
      segmentStats,
      segmentHealthSummary,
      sampleSize: logs.length,
      updatedAt: new Date(now).toISOString()
    };
    cachedPerformanceUntil = now + PERFORMANCE_CACHE_TTL_MS;
    return cachedPerformance;
  } catch (error) {
    console.error(`[AI Learning] Analysis failed: ${error.message}`);
    return null;
  }
}

function getSegmentAdaptiveAdjustment(performance, segmentKey) {
  if (!performance || !segmentKey) {
    return {
      adjustment: 0,
      applied: false,
      reason: 'no_performance_data',
      cooldownActive: false,
      total: 0,
      winRate: null
    };
  }

  const stat = performance.segmentStats?.[segmentKey];
  const total = Number(stat?.total || 0);
  if (total < SIGNAL_SEGMENT_MIN_SAMPLE) {
    return {
      adjustment: 0,
      applied: false,
      reason: 'insufficient_segment_sample',
      cooldownActive: false,
      total,
      winRate: null
    };
  }

  const win = Number(stat?.win || 0);
  const winRate = total > 0 ? (win / total) * 100 : 0;
  const cooldownUntil = Number(segmentCooldownMap.get(segmentKey) || 0);
  const cooldownActive = cooldownUntil > nowMs();
  if (cooldownActive) {
    return {
      adjustment: -10,
      applied: true,
      reason: 'segment_cooldown_active',
      cooldownActive: true,
      cooldownUntil: new Date(cooldownUntil).toISOString(),
      total,
      winRate: Math.round(winRate * 10) / 10
    };
  }

  if (winRate < 38) {
    return {
      adjustment: -8,
      applied: true,
      reason: 'weak_segment',
      cooldownActive: false,
      total,
      winRate: Math.round(winRate * 10) / 10
    };
  }

  if (winRate > 68) {
    return {
      adjustment: 4,
      applied: true,
      reason: 'strong_segment',
      cooldownActive: false,
      total,
      winRate: Math.round(winRate * 10) / 10
    };
  }

  return {
    adjustment: 0,
    applied: false,
    reason: 'neutral_segment',
    cooldownActive: false,
    total,
    winRate: Math.round(winRate * 10) / 10
  };
}

module.exports = {
  analyzePerformance,
  resolveConfidenceBand,
  buildSegmentKey,
  getSegmentAdaptiveAdjustment,
  getSegmentHealthSummary
};
