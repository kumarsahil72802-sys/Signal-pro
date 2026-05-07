function parseBooleanEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumberEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnumEnv(value, allowedValues, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toUpperCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

const SIGNAL_PROFILE = (process.env.SIGNAL_PROFILE || 'BALANCED').trim().toUpperCase();
const PROFILE_PRESETS = {
  STRICT: {
    thresholdOffset: 0,
    cooldownHours: 2,
    allowRangingBreakouts: false,
    useBtcHardBlock: true,
    use4hHardFilter: true,
    aiRejectMode: 'HARD',
    triggerSlopeMinAbs: 0.05,
    emaProximityPct: 0.3,
    emaTestPct: 0.3,
    requireZoneRejection: true,
    rangingSlopeMax: 0.05,
    rangingBbMax: 1.5,
    liquidityRejectMode: 'HARD'
  },
  BALANCED: {
    thresholdOffset: -6,
    cooldownHours: 1,
    allowRangingBreakouts: true,
    useBtcHardBlock: false,
    use4hHardFilter: false,
    aiRejectMode: 'HARD',
    triggerSlopeMinAbs: 0.03,
    emaProximityPct: 0.45,
    emaTestPct: 0.45,
    requireZoneRejection: false,
    rangingSlopeMax: 0.03,
    rangingBbMax: 1.2,
    liquidityRejectMode: 'SOFT'
  },
  AGGRESSIVE: {
    thresholdOffset: -10,
    cooldownHours: 0.5,
    allowRangingBreakouts: true,
    useBtcHardBlock: false,
    use4hHardFilter: false,
    aiRejectMode: 'OFF',
    triggerSlopeMinAbs: 0.02,
    emaProximityPct: 0.6,
    emaTestPct: 0.6,
    requireZoneRejection: false,
    rangingSlopeMax: 0.02,
    rangingBbMax: 1.0,
    liquidityRejectMode: 'OFF'
  }
};
const PROFILE_CONFIG = PROFILE_PRESETS[SIGNAL_PROFILE] || PROFILE_PRESETS.BALANCED;

const COIN_SELECTOR = (process.env.SIGNAL_COINS || 'TOP50').trim().toUpperCase();
const SIGNAL_TOP_COINS = Math.max(1, Number(process.env.SIGNAL_TOP_COINS || 50));
const SIGNAL_MAX_COINS = Math.max(1, Number(process.env.SIGNAL_MAX_COINS || 120));
const SIGNAL_MIN_24H_QUOTE_VOLUME_USDT = Math.max(0, Number(process.env.SIGNAL_MIN_24H_QUOTE_VOLUME_USDT || 2000000));
const SIGNAL_USE_EXECUTION_QUALITY = String(process.env.SIGNAL_USE_EXECUTION_QUALITY || 'true').trim().toLowerCase() !== 'false';
const SIGNAL_THRESHOLD_OFFSET = Number.isFinite(Number(process.env.SIGNAL_THRESHOLD_OFFSET))
  ? Number(process.env.SIGNAL_THRESHOLD_OFFSET)
  : PROFILE_CONFIG.thresholdOffset;
const SIGNAL_COOLDOWN_HOURS = Math.max(
  0,
  Number.isFinite(Number(process.env.SIGNAL_COOLDOWN_HOURS))
    ? Number(process.env.SIGNAL_COOLDOWN_HOURS)
    : PROFILE_CONFIG.cooldownHours
);
const SIGNAL_ALLOW_RANGING_BREAKOUTS = parseBooleanEnv(
  process.env.SIGNAL_ALLOW_RANGING_BREAKOUTS,
  PROFILE_CONFIG.allowRangingBreakouts
);
const SIGNAL_USE_BTC_HARD_BLOCK = parseBooleanEnv(
  process.env.SIGNAL_USE_BTC_HARD_BLOCK,
  PROFILE_CONFIG.useBtcHardBlock
);
const SIGNAL_USE_4H_HARD_FILTER = parseBooleanEnv(
  process.env.SIGNAL_USE_4H_HARD_FILTER,
  PROFILE_CONFIG.use4hHardFilter
);
const SIGNAL_AI_REJECT_MODE = (process.env.SIGNAL_AI_REJECT_MODE || PROFILE_CONFIG.aiRejectMode).trim().toUpperCase();
const SIGNAL_AI_MODE = parseEnumEnv(process.env.SIGNAL_AI_MODE, ['ADVISORY', 'GATED'], 'ADVISORY');
const SIGNAL_AI_ENRICHMENT_TIMING = parseEnumEnv(process.env.SIGNAL_AI_ENRICHMENT_TIMING, ['SYNC', 'ASYNC'], 'SYNC');
const SIGNAL_AI_RETRY_COUNT = Math.max(0, Math.min(5, parseNumberEnv(process.env.SIGNAL_AI_RETRY_COUNT, 2)));
const SIGNAL_AI_RETRY_BACKOFF_MS = Math.max(250, parseNumberEnv(process.env.SIGNAL_AI_RETRY_BACKOFF_MS, 1500));
const SIGNAL_AI_TIMEOUT_MS = Math.max(1000, parseNumberEnv(process.env.SIGNAL_AI_TIMEOUT_MS, 10000));
const SIGNAL_AI_TRIGGER_MIN_CONFIDENCE = Math.max(0, Math.min(100, parseNumberEnv(process.env.SIGNAL_AI_TRIGGER_MIN_CONFIDENCE, 60)));
const SIGNAL_AI_429_COOLDOWN_MS = Math.max(60 * 1000, parseNumberEnv(process.env.SIGNAL_AI_429_COOLDOWN_MS, 15 * 60 * 1000));
const SIGNAL_MACHINE_VERSION = (process.env.SIGNAL_MACHINE_VERSION || 'winrate_v1').trim();
const SIGNAL_LIQUIDITY_REJECT_MODE = (process.env.SIGNAL_LIQUIDITY_REJECT_MODE || PROFILE_CONFIG.liquidityRejectMode || 'SOFT').trim().toUpperCase();
const SIGNAL_DEPTH_LIMIT = Math.min(1000, Math.max(20, Number(process.env.SIGNAL_DEPTH_LIMIT || 100)));
const SIGNAL_ORDERBOOK_RANGE_PCT = Math.max(0.2, Number(process.env.SIGNAL_ORDERBOOK_RANGE_PCT || 1.5));
const SIGNAL_ORDERBOOK_NEAR_RANGE_PCT = Math.max(0.1, Number(process.env.SIGNAL_ORDERBOOK_NEAR_RANGE_PCT || 0.5));
const SIGNAL_WHALE_WALL_MULTIPLIER = Math.max(1.2, Number(process.env.SIGNAL_WHALE_WALL_MULTIPLIER || 2.5));
const SIGNAL_WHALE_WALL_DOMINANCE = Math.max(1.05, Number(process.env.SIGNAL_WHALE_WALL_DOMINANCE || 1.6));
const SIGNAL_TRIGGER_SLOPE_MIN_ABS = Math.max(
  0,
  Number.isFinite(Number(process.env.SIGNAL_TRIGGER_SLOPE_MIN_ABS))
    ? Number(process.env.SIGNAL_TRIGGER_SLOPE_MIN_ABS)
    : PROFILE_CONFIG.triggerSlopeMinAbs
);
const SIGNAL_EMA_PROXIMITY_PCT = Math.max(
  0.05,
  Number.isFinite(Number(process.env.SIGNAL_EMA_PROXIMITY_PCT))
    ? Number(process.env.SIGNAL_EMA_PROXIMITY_PCT)
    : PROFILE_CONFIG.emaProximityPct
);
const SIGNAL_EMA_TEST_PCT = Math.max(
  0.05,
  Number.isFinite(Number(process.env.SIGNAL_EMA_TEST_PCT))
    ? Number(process.env.SIGNAL_EMA_TEST_PCT)
    : PROFILE_CONFIG.emaTestPct
);
const SIGNAL_REQUIRE_ZONE_REJECTION = parseBooleanEnv(
  process.env.SIGNAL_REQUIRE_ZONE_REJECTION,
  PROFILE_CONFIG.requireZoneRejection
);
const SIGNAL_RANGING_SLOPE_MAX = Math.max(
  0.005,
  Number.isFinite(Number(process.env.SIGNAL_RANGING_SLOPE_MAX))
    ? Number(process.env.SIGNAL_RANGING_SLOPE_MAX)
    : PROFILE_CONFIG.rangingSlopeMax
);
const SIGNAL_RANGING_BB_MAX = Math.max(
  0.2,
  Number.isFinite(Number(process.env.SIGNAL_RANGING_BB_MAX))
    ? Number(process.env.SIGNAL_RANGING_BB_MAX)
    : PROFILE_CONFIG.rangingBbMax
);
const COIN_LIST_REFRESH_MS = 15 * 60 * 1000;
const TRADABLE_SYMBOL_CACHE_MS = 15 * 60 * 1000;
const TRADABLE_SYMBOL_FETCH_LIMIT = 1500;
const INTERVAL = process.env.SIGNAL_INTERVAL || '1h';
const CANDLE_COUNT = 100;
const TREND_CANDLES = 22;
const CHECK_INTERVAL_MS = Math.max(30 * 1000, parseNumberEnv(process.env.SIGNAL_CHECK_INTERVAL_MS, 60 * 1000));
const SIGNAL_MONITOR_INTERVAL_MS = Math.max(15 * 1000, parseNumberEnv(process.env.SIGNAL_MONITOR_INTERVAL_MS, 60 * 1000));
const SIGNAL_RECONCILE_MIN_INTERVAL_MS = Math.max(60 * 1000, parseNumberEnv(process.env.SIGNAL_RECONCILE_MIN_INTERVAL_MS, 5 * 60 * 1000));
const CONFIDENCE_THRESHOLD_KEY = 'confidence_threshold';
const DEFAULT_MIN_CONFIDENCE = 60;
const MIN_MOMENTUM_PCT = 0.7;
const ANALYSIS_WINDOW_SIZE = 50;
const LEARNING_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const MIN_CONFIDENCE_FLOOR = 55;
const MIN_CONFIDENCE_CEILING = 80;
const SIGNAL_VALIDITY_HOURS = Math.max(1, Number(process.env.SIGNAL_VALIDITY_HOURS || 8));
const COOLDOWN_MS = SIGNAL_COOLDOWN_HOURS * 60 * 60 * 1000;
const SIGNAL_VALIDITY_MS = SIGNAL_VALIDITY_HOURS * 60 * 60 * 1000;
const SIGNAL_REPLAY_INTERVAL = (process.env.SIGNAL_REPLAY_INTERVAL || '1m').trim();
const SIGNAL_REPLAY_KLINE_LIMIT = Math.min(1000, Math.max(50, Number(process.env.SIGNAL_REPLAY_KLINE_LIMIT || 1000)));
const SIGNAL_REPLAY_MAX_GAP_HOURS = Math.max(1, Number(process.env.SIGNAL_REPLAY_MAX_GAP_HOURS || 72));
const SIGNAL_REPLAY_RETRY_COUNT = Math.max(0, Math.min(5, Number(process.env.SIGNAL_REPLAY_RETRY_COUNT || 2)));
const SIGNAL_REPLAY_AMBIGUITY_POLICY = (process.env.SIGNAL_REPLAY_AMBIGUITY_POLICY || 'CONSERVATIVE').trim().toUpperCase();
const SIGNAL_RECONCILE_ON_MONITOR = parseBooleanEnv(process.env.SIGNAL_RECONCILE_ON_MONITOR, true);
const SIGNAL_MONITOR_CHECKPOINT_KEY = (process.env.SIGNAL_MONITOR_CHECKPOINT_KEY || 'signal_monitor_checkpoint_ms').trim();
const SIGNAL_WINRATE_BASELINE_WINDOW = Math.max(50, Math.min(400, parseNumberEnv(process.env.SIGNAL_WINRATE_BASELINE_WINDOW, 200)));
const SIGNAL_WINRATE_BASELINE_MIN_SAMPLE = Math.max(30, Math.min(SIGNAL_WINRATE_BASELINE_WINDOW, parseNumberEnv(process.env.SIGNAL_WINRATE_BASELINE_MIN_SAMPLE, 120)));
const SIGNAL_SEGMENT_MIN_SAMPLE = Math.max(6, Math.min(60, parseNumberEnv(process.env.SIGNAL_SEGMENT_MIN_SAMPLE, 10)));
const SIGNAL_SEGMENT_COOLDOWN_MINUTES = Math.max(10, parseNumberEnv(process.env.SIGNAL_SEGMENT_COOLDOWN_MINUTES, 180));
const SIGNAL_SENTIMENT_NEWS_LIMIT = Math.max(5, Math.min(20, parseNumberEnv(process.env.SIGNAL_SENTIMENT_NEWS_LIMIT, 12)));
const SIGNAL_SENTIMENT_ENABLED = parseBooleanEnv(process.env.SIGNAL_SENTIMENT_ENABLED, true);

const STABLE_BASE_ASSETS = new Set([
  'USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'PYUSD'
]);

const settings = {
  SIGNAL_PROFILE,
  PROFILE_PRESETS,
  PROFILE_CONFIG,
  COIN_SELECTOR,
  SIGNAL_TOP_COINS,
  SIGNAL_MAX_COINS,
  SIGNAL_MIN_24H_QUOTE_VOLUME_USDT,
  SIGNAL_USE_EXECUTION_QUALITY,
  SIGNAL_THRESHOLD_OFFSET,
  SIGNAL_COOLDOWN_HOURS,
  SIGNAL_ALLOW_RANGING_BREAKOUTS,
  SIGNAL_USE_BTC_HARD_BLOCK,
  SIGNAL_USE_4H_HARD_FILTER,
  SIGNAL_AI_REJECT_MODE,
  SIGNAL_AI_MODE,
  SIGNAL_AI_ENRICHMENT_TIMING,
  SIGNAL_AI_RETRY_COUNT,
  SIGNAL_AI_RETRY_BACKOFF_MS,
  SIGNAL_AI_TIMEOUT_MS,
  SIGNAL_AI_TRIGGER_MIN_CONFIDENCE,
  SIGNAL_AI_429_COOLDOWN_MS,
  SIGNAL_MACHINE_VERSION,
  SIGNAL_LIQUIDITY_REJECT_MODE,
  SIGNAL_DEPTH_LIMIT,
  SIGNAL_ORDERBOOK_RANGE_PCT,
  SIGNAL_ORDERBOOK_NEAR_RANGE_PCT,
  SIGNAL_WHALE_WALL_MULTIPLIER,
  SIGNAL_WHALE_WALL_DOMINANCE,
  SIGNAL_TRIGGER_SLOPE_MIN_ABS,
  SIGNAL_EMA_PROXIMITY_PCT,
  SIGNAL_EMA_TEST_PCT,
  SIGNAL_REQUIRE_ZONE_REJECTION,
  SIGNAL_RANGING_SLOPE_MAX,
  SIGNAL_RANGING_BB_MAX,
  COIN_LIST_REFRESH_MS,
  TRADABLE_SYMBOL_CACHE_MS,
  TRADABLE_SYMBOL_FETCH_LIMIT,
  INTERVAL,
  CANDLE_COUNT,
  TREND_CANDLES,
  CHECK_INTERVAL_MS,
  SIGNAL_MONITOR_INTERVAL_MS,
  SIGNAL_RECONCILE_MIN_INTERVAL_MS,
  CONFIDENCE_THRESHOLD_KEY,
  DEFAULT_MIN_CONFIDENCE,
  MIN_MOMENTUM_PCT,
  ANALYSIS_WINDOW_SIZE,
  LEARNING_CHECK_INTERVAL_MS,
  MIN_CONFIDENCE_FLOOR,
  MIN_CONFIDENCE_CEILING,
  SIGNAL_VALIDITY_HOURS,
  SIGNAL_VALIDITY_MS,
  SIGNAL_REPLAY_INTERVAL,
  SIGNAL_REPLAY_KLINE_LIMIT,
  SIGNAL_REPLAY_MAX_GAP_HOURS,
  SIGNAL_REPLAY_RETRY_COUNT,
  SIGNAL_REPLAY_AMBIGUITY_POLICY,
  SIGNAL_RECONCILE_ON_MONITOR,
  SIGNAL_MONITOR_CHECKPOINT_KEY,
  SIGNAL_WINRATE_BASELINE_WINDOW,
  SIGNAL_WINRATE_BASELINE_MIN_SAMPLE,
  SIGNAL_SEGMENT_MIN_SAMPLE,
  SIGNAL_SEGMENT_COOLDOWN_MINUTES,
  SIGNAL_SENTIMENT_NEWS_LIMIT,
  SIGNAL_SENTIMENT_ENABLED,
  COOLDOWN_MS,
  STABLE_BASE_ASSETS
};

module.exports = {
  settings
};
