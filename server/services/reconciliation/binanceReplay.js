const { getKlines } = require('../binanceService');
const { settings } = require('../signalEngine/config');

const {
  SIGNAL_REPLAY_INTERVAL,
  SIGNAL_REPLAY_KLINE_LIMIT,
  SIGNAL_REPLAY_RETRY_COUNT
} = settings;

function intervalToMs(interval) {
  const map = {
    '1m': 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000
  };
  return map[interval] || 60 * 1000;
}

async function fetchKlinesWithRetry(symbol, interval, limit, options = {}) {
  let lastError = null;
  const retryCount = Math.max(0, SIGNAL_REPLAY_RETRY_COUNT);
  const attempts = retryCount + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getKlines(symbol, interval, limit, options);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const backoffMs = Math.min(1500, attempt * 400);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new Error('Unknown replay fetch failure');
}

async function fetchReplayCandles(symbol, startMs, endMs, options = {}) {
  const interval = options.interval || SIGNAL_REPLAY_INTERVAL || '1m';
  const limit = Math.min(1000, Math.max(50, options.limit || SIGNAL_REPLAY_KLINE_LIMIT || 1000));
  const intervalMs = intervalToMs(interval);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const candles = [];
  const seen = new Set();
  let cursor = Math.floor(startMs);
  const hardStop = Math.floor(endMs);
  let guard = 0;

  while (cursor <= hardStop && guard < 5000) {
    guard += 1;
    const chunk = await fetchKlinesWithRetry(symbol, interval, limit, {
      startTime: cursor,
      endTime: hardStop
    });

    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }

    for (const candle of chunk) {
      if (!candle || !Number.isFinite(candle.openTime)) continue;
      if (candle.openTime < startMs || candle.openTime > hardStop) continue;
      if (seen.has(candle.openTime)) continue;
      seen.add(candle.openTime);
      candles.push(candle);
    }

    const lastCandle = chunk[chunk.length - 1];
    const nextCursor = Number(lastCandle?.openTime) + intervalMs;
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) {
      break;
    }

    if (chunk.length < limit) {
      break;
    }
    cursor = nextCursor;
  }

  candles.sort((a, b) => a.openTime - b.openTime);
  return candles;
}

module.exports = {
  fetchReplayCandles,
  intervalToMs
};
