const yahooFinance = require('yahoo-finance2').default;

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 10;
const DEFAULT_STRONG_TREND_PCT = 0.35;

const MACRO_SYMBOLS = {
  dxy: { symbol: 'DX-Y.NYB', label: 'DXY' },
  sp500: { symbol: '^GSPC', label: 'S&P 500' }
};

let macroCache = {
  data: null,
  expiresAt: 0
};

function toNumberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function classifyTrend(changePct, strongPct, moderatePct) {
  const absChange = Math.abs(changePct);
  if (absChange < moderatePct) {
    return { direction: 'FLAT', strength: 'WEAK', trend: 'FLAT' };
  }

  if (changePct > 0) {
    if (absChange >= strongPct) {
      return { direction: 'UP', strength: 'STRONG', trend: 'UP_STRONG' };
    }
    return { direction: 'UP', strength: 'MODERATE', trend: 'UP' };
  }

  if (absChange >= strongPct) {
    return { direction: 'DOWN', strength: 'STRONG', trend: 'DOWN_STRONG' };
  }
  return { direction: 'DOWN', strength: 'MODERATE', trend: 'DOWN' };
}

function buildUnavailableSnapshot(config, reason = 'UNAVAILABLE') {
  return {
    symbol: config.symbol,
    label: config.label,
    lastClose: null,
    startClose: null,
    changePct: 0,
    direction: 'FLAT',
    strength: 'WEAK',
    trend: 'FLAT',
    unavailable: true,
    reason
  };
}

async function fetchTrendSnapshot(config) {
  const lookbackDays = Math.max(
    3,
    Math.round(toNumberEnv(process.env.MACRO_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS))
  );
  const strongTrendPct = Math.max(
    0.05,
    toNumberEnv(process.env.MACRO_STRONG_TREND_PCT, DEFAULT_STRONG_TREND_PCT)
  );
  const moderateTrendPct = Math.max(0.01, strongTrendPct * 0.5);

  const period1 = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const candles = await yahooFinance.historical(config.symbol, {
    period1,
    interval: '1d'
  });

  const closes = (candles || [])
    .map((candle) => Number(candle?.close))
    .filter((close) => Number.isFinite(close) && close > 0);

  if (closes.length < 2) {
    return buildUnavailableSnapshot(config, 'INSUFFICIENT_DATA');
  }

  const startClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const changePct = ((lastClose - startClose) / startClose) * 100;
  const trend = classifyTrend(changePct, strongTrendPct, moderateTrendPct);

  return {
    symbol: config.symbol,
    label: config.label,
    lastClose,
    startClose,
    changePct,
    direction: trend.direction,
    strength: trend.strength,
    trend: trend.trend,
    unavailable: false,
    sampleSize: closes.length
  };
}

function getCacheTtlMs() {
  const ttlMinutes = Math.max(5, toNumberEnv(process.env.MACRO_CACHE_TTL_MINUTES, 60));
  return ttlMinutes * 60 * 1000;
}

async function getMacroTrendSnapshot(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();
  const cacheTtlMs = getCacheTtlMs();

  if (!forceRefresh && macroCache.data && now < macroCache.expiresAt) {
    return macroCache.data;
  }

  try {
    const [dxy, sp500] = await Promise.all([
      fetchTrendSnapshot(MACRO_SYMBOLS.dxy),
      fetchTrendSnapshot(MACRO_SYMBOLS.sp500)
    ]);

    const snapshot = {
      dxy,
      sp500,
      fetchedAt: new Date().toISOString(),
      cacheTtlMinutes: Math.round(cacheTtlMs / 60000)
    };

    macroCache = {
      data: snapshot,
      expiresAt: now + cacheTtlMs
    };

    return snapshot;
  } catch (error) {
    if (macroCache.data) {
      return macroCache.data;
    }

    return {
      dxy: buildUnavailableSnapshot(MACRO_SYMBOLS.dxy, error.message),
      sp500: buildUnavailableSnapshot(MACRO_SYMBOLS.sp500, error.message),
      fetchedAt: new Date().toISOString(),
      cacheTtlMinutes: Math.round(cacheTtlMs / 60000)
    };
  }
}

module.exports = { getMacroTrendSnapshot };
