const { getTopCoinsSnapshot } = require('../coingeckoService');
const Signal = require('../../models/Signal');
const {
  settings,
  parseTopSelector,
  resolveCoins,
  loadThresholdFromDB,
  getConfidenceThreshold,
  getEffectiveConfidenceThreshold,
  updateConfidenceThreshold,
  getLastLearningCheck,
  setLastLearningCheck,
  getLearningDiagnostics,
  setLearningDiagnostics,
  isEngineRunning,
  setEngineRunning,
  setEngineStartTime,
  isEngineTickInProgress,
  setEngineTickInProgress
} = require('./config');
const { getBTCTrend } = require('./analysis');
const { generateSignalForCoin } = require('./signalGenerator');
const { analyzePerformance } = require('../aiLearning');
const {
  ensureWinrateBaseline,
  buildWinrateDiagnostics
} = require('../winrateDiagnosticsService');

const {
  LEARNING_CHECK_INTERVAL_MS,
  ANALYSIS_WINDOW_SIZE,
  MIN_CONFIDENCE_CEILING,
  MIN_CONFIDENCE_FLOOR,
  COIN_SELECTOR,
  SIGNAL_TOP_COINS,
  CHECK_INTERVAL_MS,
  SIGNAL_PROFILE,
  SIGNAL_MAX_COINS,
  SIGNAL_COOLDOWN_HOURS,
  SIGNAL_USE_4H_HARD_FILTER,
  SIGNAL_USE_BTC_HARD_BLOCK,
  SIGNAL_AI_REJECT_MODE,
  SIGNAL_LIQUIDITY_REJECT_MODE,
  SIGNAL_DEPTH_LIMIT,
  SIGNAL_ORDERBOOK_RANGE_PCT,
  SIGNAL_TRIGGER_SLOPE_MIN_ABS,
  SIGNAL_EMA_PROXIMITY_PCT,
  SIGNAL_EMA_TEST_PCT,
  SIGNAL_RANGING_SLOPE_MAX,
  SIGNAL_RANGING_BB_MAX,
  SIGNAL_VALIDITY_HOURS,
  SIGNAL_AI_MODE,
  SIGNAL_AI_ENRICHMENT_TIMING,
  SIGNAL_AI_RETRY_COUNT,
  SIGNAL_AI_RETRY_BACKOFF_MS,
  SIGNAL_AI_TIMEOUT_MS,
  SIGNAL_MIN_SIGNALS_PER_DAY,
  SIGNAL_SUPPLY_LOOKBACK_HOURS,
  SIGNAL_SUPPLY_ADJUST_STEP,
  SIGNAL_SUPPLY_MIN_BASE_THRESHOLD
} = settings;

// ============================================================================
// ENGINE RUNNER
// ============================================================================

/**
 * Auto-learning: Analyze recent performance and adjust confidence threshold
 * FIXED: Only count TAKEN signals for win rate calculation
 * - TARGET_HIT not-taken signals are tracked separately, NOT a loss
 * - EXPIRED signals (time-based signal timeout) → separate counter, NOT a loss
 * - winRate < 50% → tighten rules (increase threshold)
 * - winRate > 70% → relax rules (decrease threshold)
 * - Minimum 10 taken signals required before adjusting threshold
 */
async function runAutoLearning() {
  const now = Date.now();
  const lastLearningCheck = getLastLearningCheck();

  // Only run every hour
  if (now - lastLearningCheck < LEARNING_CHECK_INTERVAL_MS) {
    return;
  }
  setLastLearningCheck(now);

  try {
    await ensureWinrateBaseline();

    // Get total count of all signals ever generated (for rate calculations)
    const totalGenerated = await Signal.countDocuments();

    // Get TAKEN signals that are CLOSED (user took these, result is known)
    // FIXED: Use wasTaken flag to only include signals user actually took
    // This is the ONLY set that should count toward win rate
    const takenSignals = await Signal.find({
      status: 'CLOSED',
      wasTaken: true,  // Only signals user actually took
      result: { $in: ['TARGET_HIT', 'SL_HIT'] }
    })
      .sort({ closedAt: -1 })
      .limit(ANALYSIS_WINDOW_SIZE);

    // Count target-hit opportunities (user didn't take, target hit)
    const missedOpportunities = await Signal.countDocuments({
      result: 'TARGET_HIT',
      wasTaken: false
    });

    // Count EXPIRED signals (time-based timeout)
    const expiredCount = await Signal.countDocuments({
      status: 'CLOSED',
      result: 'EXPIRED'
    });

    // Now calculate proper metrics
    // wins = TAKEN + TARGET_HIT
    const wins = takenSignals.filter(s => s.result === 'TARGET_HIT').length;
    const losses = takenSignals.filter(s => s.result === 'SL_HIT').length;
    const takenCount = takenSignals.length;

    // FIXED: Win rate based ONLY on taken signals
    const winRate = takenCount > 0 ? (wins / takenCount) * 100 : 0;

    const oldThreshold = getConfidenceThreshold();
    let newThreshold = oldThreshold;
    let reason = 'no change';

    // FIXED: Only adjust threshold if we have enough taken signals (minimum sample size)
    if (takenCount < 10) {
      console.log(`[LEARNING] Insufficient taken signals (${takenCount}/10), skipping threshold adjustment. ` +
        `Win rate: ${winRate.toFixed(1)}% (based on ${takenCount} taken signals). ` +
        `TargetHit: ${missedOpportunities}, Expired: ${expiredCount}`);

      const perf = await analyzePerformance();
      const diagnostics = await buildWinrateDiagnostics({
        segmentHealthSummary: perf?.segmentHealthSummary || null
      });
      setLearningDiagnostics({
        ...diagnostics,
        generatedSignals: totalGenerated,
        totalTaken: takenCount,
        missedOpportunities,
        expiredSignals: expiredCount,
        threshold: oldThreshold,
        thresholdChanged: false,
        updatedAt: new Date().toISOString()
      });
      return;
    }

    // Adjust threshold based on performance (only using TAKEN signals)
    if (winRate < 50) {
      // Poor performance - tighten rules
      newThreshold = Math.min(MIN_CONFIDENCE_CEILING, oldThreshold + 5);
      reason = 'winRate below 50';
    } else if (winRate > 70) {
      // Good performance - can relax slightly
      newThreshold = Math.max(MIN_CONFIDENCE_FLOOR, oldThreshold - 3);
      reason = 'winRate above 70';
    }

    // Apply new threshold if changed
    if (newThreshold !== oldThreshold) {
      await updateConfidenceThreshold(newThreshold);
      console.log({
        event: 'threshold_adjustment',
        takenSignals: takenCount,
        wins,
        losses,
        winRate: winRate.toFixed(1),
        missedOpportunities,
        expiredSignals: expiredCount,
        oldThreshold,
        newThreshold,
        reason
      });
    } else {
      console.log({
        event: 'threshold_check',
        takenSignals: takenCount,
        wins,
        losses,
        winRate: winRate.toFixed(1),
        missedOpportunities,
        expiredSignals: expiredCount,
        threshold: oldThreshold,
        reason: 'no change needed'
      });
    }

    const perf = await analyzePerformance({ forceRefresh: true });
    const diagnostics = await buildWinrateDiagnostics({
      segmentHealthSummary: perf?.segmentHealthSummary || null
    });
    setLearningDiagnostics({
      ...diagnostics,
      generatedSignals: totalGenerated,
      totalTaken: takenCount,
      missedOpportunities,
      expiredSignals: expiredCount,
      threshold: newThreshold,
      thresholdChanged: newThreshold !== oldThreshold,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[Learning] Error during analysis: ${error.message}`);
  }
}

async function runSignalSupplyGuard(createdThisCycle) {
  if (SIGNAL_MIN_SIGNALS_PER_DAY <= 0) return;
  if (createdThisCycle > 0) return;

  const lookbackHours = Math.max(6, SIGNAL_SUPPLY_LOOKBACK_HOURS);
  const lookbackStart = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const recentSignals = await Signal.countDocuments({
    createdAt: { $gte: lookbackStart }
  });

  if (recentSignals >= SIGNAL_MIN_SIGNALS_PER_DAY) {
    return;
  }

  const currentBaseThreshold = getConfidenceThreshold();
  const step = Math.max(1, SIGNAL_SUPPLY_ADJUST_STEP);
  const minBaseThreshold = Math.max(50, SIGNAL_SUPPLY_MIN_BASE_THRESHOLD);

  if (currentBaseThreshold <= minBaseThreshold) {
    console.log(
      `[SUPPLY] Low supply detected (${recentSignals}/${SIGNAL_MIN_SIGNALS_PER_DAY} in ${lookbackHours}h) but threshold already at floor ${currentBaseThreshold}.`
    );
    return;
  }

  const nextThreshold = Math.max(minBaseThreshold, currentBaseThreshold - step);
  await updateConfidenceThreshold(nextThreshold);
  console.log(
    `[SUPPLY] Low supply detected (${recentSignals}/${SIGNAL_MIN_SIGNALS_PER_DAY} in ${lookbackHours}h). ` +
    `Lowered base threshold ${currentBaseThreshold} -> ${nextThreshold} (effective: ${getEffectiveConfidenceThreshold()}).`
  );
}


async function runEngine() {
  if (isEngineTickInProgress()) {
    console.log('[ENGINE] Previous cycle still running. Skipping overlapping tick.');
    return;
  }

  setEngineTickInProgress(true);
  try {
    // Run auto-learning before generating signals
    await runAutoLearning();

    console.log(`[ENGINE] Running signal generation (base threshold: ${getConfidenceThreshold()}, effective: ${getEffectiveConfidenceThreshold()})...`);
    let created = 0;
    const cycleGateCounts = {
      cooldown: 0,
      ranging: 0,
      no_trigger: 0,
      quality_fail: 0,
      fourh_block: 0,
      saved: 0
    };

    // Fetch market data once for all coins to avoid rate limiting
    const topSelectorCount = parseTopSelector(COIN_SELECTOR) || 0;
    const marketDataLimit = Math.min(250, Math.max(50, SIGNAL_TOP_COINS, topSelectorCount));
    let topCoins = [];
    try {
      const marketSnapshot = await getTopCoinsSnapshot(marketDataLimit, { allowStale: true });
      topCoins = marketSnapshot.coins;
      if (marketSnapshot.status.source !== 'fresh' && marketSnapshot.status.source !== 'cache') {
        console.log(`[ENGINE] CoinGecko degraded mode: ${marketSnapshot.status.source} (${marketSnapshot.status.reason || 'no_reason'})`);
      }
    } catch (err) {
      console.log(`[ENGINE] Failed to fetch market data: ${err.message}`);
    }

    // Resolve coin universe for this cycle
    let coinsToAnalyze = [];
    try {
      coinsToAnalyze = await resolveCoins(topCoins);
    } catch (err) {
      console.log(`[ENGINE] Failed to resolve coin list: ${err.message}`);
      coinsToAnalyze = ['BTCUSDT'];
    }

    console.log(`[ENGINE] Analyzing ${coinsToAnalyze.length} coin(s). Selector: ${COIN_SELECTOR}`);

    // Fetch global BTC trend once per cycle to avoid redundant API calls
    const btcTrend = await getBTCTrend();

    for (const coin of coinsToAnalyze) {
      try {
        const signal = await generateSignalForCoin(coin, topCoins, btcTrend, cycleGateCounts);
        if (signal) {
          created++;
          cycleGateCounts.saved += 1;
        }
      } catch (error) {
        console.error(`[ENGINE] ${coin}: Error - ${error.message}`);
      }
    }
    console.log(
      `[ENGINE] Cycle → cooldown:${cycleGateCounts.cooldown} | ranging:${cycleGateCounts.ranging} | no_trigger:${cycleGateCounts.no_trigger} | quality_fail:${cycleGateCounts.quality_fail} | fourh_block:${cycleGateCounts.fourh_block} | saved:${cycleGateCounts.saved}`
    );

    await runSignalSupplyGuard(created);

    if (created > 0) {
      console.log(`[ENGINE] Done. ${created} signal(s) generated.`);
    } else {
      console.log(`[ENGINE] Done. No signals generated.`);
    }
  } finally {
    setEngineTickInProgress(false);
  }
}

async function startSignalEngine() {
  // Load persisted threshold from database first
  await loadThresholdFromDB();

  setEngineRunning(true);
  setEngineStartTime(new Date());

  runEngine().catch((error) => {
    console.error(`[ENGINE] Initial run failed: ${error.message}`);
  });
  setInterval(() => {
    runEngine().catch((error) => {
      console.error(`[ENGINE] Scheduled run failed: ${error.message}`);
    });
  }, CHECK_INTERVAL_MS);
  console.log(
    `[ENGINE] Started. Profile:${SIGNAL_PROFILE} | Selector:${COIN_SELECTOR} | Interval:${Math.round(CHECK_INTERVAL_MS / 1000)}s | MaxCoins:${SIGNAL_MAX_COINS} | Cooldown:${SIGNAL_COOLDOWN_HOURS}h | Validity:${SIGNAL_VALIDITY_HOURS}h | 4HHard:${SIGNAL_USE_4H_HARD_FILTER} | BTCHard:${SIGNAL_USE_BTC_HARD_BLOCK} | AIMode:${SIGNAL_AI_MODE} | AIEnrich:${SIGNAL_AI_ENRICHMENT_TIMING} | AIRetry:${SIGNAL_AI_RETRY_COUNT}@${SIGNAL_AI_RETRY_BACKOFF_MS}ms | AITimeout:${SIGNAL_AI_TIMEOUT_MS}ms | AIReject:${SIGNAL_AI_REJECT_MODE} | LiquidityReject:${SIGNAL_LIQUIDITY_REJECT_MODE} | Depth:${SIGNAL_DEPTH_LIMIT} | DepthRange:${SIGNAL_ORDERBOOK_RANGE_PCT}% | SlopeMin:${SIGNAL_TRIGGER_SLOPE_MIN_ABS} | EMAProx:${SIGNAL_EMA_PROXIMITY_PCT}% | EMATest:${SIGNAL_EMA_TEST_PCT}% | RangeSlopeMax:${SIGNAL_RANGING_SLOPE_MAX} | RangeBBMax:${SIGNAL_RANGING_BB_MAX}%`
  );
}

function getEngineStatus() {
  return isEngineRunning() ? "running" : "stopped";
}

module.exports = {
  runAutoLearning,
  runEngine,
  startSignalEngine,
  getEngineStatus,
  getDynamicThreshold: getConfidenceThreshold,
  getLearningDiagnostics
};

