const Signal = require('../models/Signal');
const SystemConfig = require('../models/SystemConfig');
const { settings } = require('./signalEngine/config');

const {
  SIGNAL_MACHINE_VERSION,
  SIGNAL_WINRATE_BASELINE_WINDOW,
  SIGNAL_WINRATE_BASELINE_MIN_SAMPLE
} = settings;

const BASELINE_CONFIG_KEY = `signal_winrate_baseline_${SIGNAL_MACHINE_VERSION}`;

function roundOne(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

async function computeTakenWinRate(windowSize = SIGNAL_WINRATE_BASELINE_WINDOW) {
  const safeWindowSize = Math.max(1, Number(windowSize) || SIGNAL_WINRATE_BASELINE_WINDOW);
  const rows = await Signal.find({
    wasTaken: true,
    result: { $in: ['TARGET_HIT', 'SL_HIT'] }
  })
    .sort({ closedAt: -1, createdAt: -1 })
    .limit(safeWindowSize)
    .select('result')
    .lean();

  const sampleSize = rows.length;
  const wins = rows.filter((row) => row.result === 'TARGET_HIT').length;
  const winRate = sampleSize > 0 ? (wins / sampleSize) * 100 : 0;

  return {
    winRate: roundOne(winRate),
    wins,
    losses: sampleSize - wins,
    sampleSize,
    windowSize: safeWindowSize,
    coverage: roundOne((sampleSize / safeWindowSize) * 100)
  };
}

async function getStoredBaseline() {
  const value = await SystemConfig.getValue(BASELINE_CONFIG_KEY, null);
  if (!value || typeof value !== 'object') return null;

  const baselineWinRate = Number(value.baselineWinRate);
  const sampleSize = Number(value.sampleSize);
  const windowSize = Number(value.windowSize) || SIGNAL_WINRATE_BASELINE_WINDOW;
  if (!Number.isFinite(baselineWinRate) || !Number.isFinite(sampleSize)) return null;

  return {
    baselineWinRate: roundOne(baselineWinRate),
    sampleSize: Math.max(0, Math.round(sampleSize)),
    windowSize: Math.max(1, Math.round(windowSize)),
    coverage: roundOne((sampleSize / Math.max(1, windowSize)) * 100),
    updatedAt: value.updatedAt ? new Date(value.updatedAt).toISOString() : null
  };
}

async function ensureWinrateBaseline() {
  const existing = await getStoredBaseline();
  if (existing && existing.sampleSize >= SIGNAL_WINRATE_BASELINE_MIN_SAMPLE) {
    return existing;
  }

  const snapshot = await computeTakenWinRate();
  const payload = {
    baselineWinRate: snapshot.winRate,
    sampleSize: snapshot.sampleSize,
    windowSize: snapshot.windowSize,
    coverage: snapshot.coverage,
    machineVersion: SIGNAL_MACHINE_VERSION,
    minSample: SIGNAL_WINRATE_BASELINE_MIN_SAMPLE,
    updatedAt: new Date().toISOString()
  };
  await SystemConfig.setValue(BASELINE_CONFIG_KEY, payload);
  return payload;
}

async function buildWinrateDiagnostics(extra = {}) {
  const [baseline, current] = await Promise.all([
    getStoredBaseline(),
    computeTakenWinRate()
  ]);

  const baselineWinRate = baseline ? baseline.baselineWinRate : null;
  const deltaWinRate = baselineWinRate == null ? null : roundOne(current.winRate - baselineWinRate);
  const isEligibleForUplift = current.sampleSize >= SIGNAL_WINRATE_BASELINE_MIN_SAMPLE
    && Number.isFinite(Number(baseline?.sampleSize))
    && Number(baseline.sampleSize) >= SIGNAL_WINRATE_BASELINE_MIN_SAMPLE;

  return {
    machineVersion: SIGNAL_MACHINE_VERSION,
    baselineWinRate,
    currentWinRate: current.winRate,
    deltaWinRate,
    rollingSampleSize: current.sampleSize,
    sampleSize: current.sampleSize,
    coverage: current.coverage,
    upliftEligible: isEligibleForUplift,
    upliftTargetPct: 5,
    upliftTargetMet: isEligibleForUplift && Number.isFinite(deltaWinRate) && deltaWinRate >= 5,
    baselineUpdatedAt: baseline?.updatedAt || null,
    ...extra
  };
}

module.exports = {
  BASELINE_CONFIG_KEY,
  computeTakenWinRate,
  getStoredBaseline,
  ensureWinrateBaseline,
  buildWinrateDiagnostics
};
