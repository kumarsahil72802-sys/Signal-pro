const { getOrderBook } = require('../../binanceService');
const { settings } = require('../config');

const {
  SIGNAL_ORDERBOOK_RANGE_PCT,
  SIGNAL_ORDERBOOK_NEAR_RANGE_PCT,
  SIGNAL_WHALE_WALL_MULTIPLIER,
  SIGNAL_WHALE_WALL_DOMINANCE,
  SIGNAL_DEPTH_LIMIT
} = settings;

const DEPTH_HISTORY_LIMIT = 40;
const DEPTH_HISTORY_MAX_AGE_MS = 20 * 60 * 1000;
const depthHistoryBySymbol = new Map();

function sumQuoteVolume(levels) {
  return levels.reduce((sum, [price, qty]) => sum + (price * qty), 0);
}

function summarizeBookSide(levels, currentPrice, nearUpperPrice) {
  const totalQuoteVolume = sumQuoteVolume(levels);
  const averageLevelQuoteVolume = levels.length > 0 ? totalQuoteVolume / levels.length : 0;

  let maxLevelQuoteVolume = 0;
  let maxLevelPrice = 0;
  for (const [price, qty] of levels) {
    const quoteVol = price * qty;
    if (quoteVol > maxLevelQuoteVolume) {
      maxLevelQuoteVolume = quoteVol;
      maxLevelPrice = price;
    }
  }

  const nearLevels = levels.filter(([price]) => price <= nearUpperPrice);
  const nearQuoteVolume = sumQuoteVolume(nearLevels);
  const nearPressurePct = totalQuoteVolume > 0 ? (nearQuoteVolume / totalQuoteVolume) * 100 : 0;
  const maxLevelDistancePct = maxLevelPrice > 0
    ? Math.abs(((maxLevelPrice - currentPrice) / currentPrice) * 100)
    : 0;

  return {
    totalQuoteVolume,
    averageLevelQuoteVolume,
    maxLevelQuoteVolume,
    maxLevelPrice,
    nearQuoteVolume,
    nearPressurePct,
    maxLevelDistancePct
  };
}

function analyzeOrderBookLiquidity(orderBook, currentPrice, trend) {
  if (!orderBook || !Array.isArray(orderBook.bids) || !Array.isArray(orderBook.asks)) {
    return null;
  }

  const rangeRatio = SIGNAL_ORDERBOOK_RANGE_PCT / 100;
  const nearRangeRatio = SIGNAL_ORDERBOOK_NEAR_RANGE_PCT / 100;
  const minBidPrice = currentPrice * (1 - rangeRatio);
  const maxAskPrice = currentPrice * (1 + rangeRatio);
  const nearAskPrice = currentPrice * (1 + nearRangeRatio);
  const nearBidPrice = currentPrice * (1 - nearRangeRatio);

  const bidsInRange = orderBook.bids.filter(([price]) => price <= currentPrice && price >= minBidPrice);
  const asksInRange = orderBook.asks.filter(([price]) => price >= currentPrice && price <= maxAskPrice);

  const bidSummary = summarizeBookSide(bidsInRange, currentPrice, currentPrice);
  const askSummary = summarizeBookSide(asksInRange, currentPrice, nearAskPrice);

  const bidsNear = bidsInRange.filter(([price]) => price >= nearBidPrice);
  const bidNearQuoteVolume = sumQuoteVolume(bidsNear);
  const bidNearPressurePct = bidSummary.totalQuoteVolume > 0
    ? (bidNearQuoteVolume / bidSummary.totalQuoteVolume) * 100
    : 0;

  const bidAskVolumeRatio = askSummary.totalQuoteVolume > 0
    ? bidSummary.totalQuoteVolume / askSummary.totalQuoteVolume
    : bidSummary.totalQuoteVolume > 0 ? 99 : 1;

  const massiveAskWallDetected = askSummary.maxLevelQuoteVolume > 0
    && askSummary.averageLevelQuoteVolume > 0
    && askSummary.maxLevelQuoteVolume >= askSummary.averageLevelQuoteVolume * SIGNAL_WHALE_WALL_MULTIPLIER
    && askSummary.maxLevelDistancePct <= SIGNAL_ORDERBOOK_RANGE_PCT;

  const massiveBidWallDetected = bidSummary.maxLevelQuoteVolume > 0
    && bidSummary.averageLevelQuoteVolume > 0
    && bidSummary.maxLevelQuoteVolume >= bidSummary.averageLevelQuoteVolume * SIGNAL_WHALE_WALL_MULTIPLIER
    && bidSummary.maxLevelDistancePct <= SIGNAL_ORDERBOOK_RANGE_PCT;

  let blockedByLiquidity = false;
  if (trend === 'BUY' && massiveAskWallDetected) {
    blockedByLiquidity =
      askSummary.nearPressurePct >= 60
      || bidAskVolumeRatio < 0.7
      || askSummary.totalQuoteVolume >= bidSummary.totalQuoteVolume * SIGNAL_WHALE_WALL_DOMINANCE;
  }

  if (trend === 'SELL' && massiveBidWallDetected) {
    blockedByLiquidity =
      bidNearPressurePct >= 60
      || bidAskVolumeRatio > 1.4
      || bidSummary.totalQuoteVolume >= askSummary.totalQuoteVolume * SIGNAL_WHALE_WALL_DOMINANCE;
  }

  return {
    depthRangePct: SIGNAL_ORDERBOOK_RANGE_PCT,
    nearRangePct: SIGNAL_ORDERBOOK_NEAR_RANGE_PCT,
    bidQuoteVolume: bidSummary.totalQuoteVolume,
    askQuoteVolume: askSummary.totalQuoteVolume,
    bidAskVolumeRatio,
    askWallPrice: askSummary.maxLevelPrice || null,
    askWallVolume: askSummary.maxLevelQuoteVolume,
    askWallPressurePct: askSummary.nearPressurePct,
    bidWallPrice: bidSummary.maxLevelPrice || null,
    bidWallVolume: bidSummary.maxLevelQuoteVolume,
    bidWallPressurePct: bidNearPressurePct,
    massiveAskWallDetected,
    massiveBidWallDetected,
    blockedByLiquidity
  };
}

function pruneDepthHistory(symbol, now = Date.now()) {
  const history = depthHistoryBySymbol.get(symbol);
  if (!Array.isArray(history) || history.length === 0) {
    depthHistoryBySymbol.set(symbol, []);
    return [];
  }

  const filtered = history
    .filter((item) => now - item.ts <= DEPTH_HISTORY_MAX_AGE_MS)
    .slice(-DEPTH_HISTORY_LIMIT);

  depthHistoryBySymbol.set(symbol, filtered);
  return filtered;
}

function addDepthSnapshot(symbol, snapshot) {
  const history = pruneDepthHistory(symbol);
  history.push({
    ts: Date.now(),
    bidAskVolumeRatio: snapshot.bidAskVolumeRatio,
    massiveAskWallDetected: snapshot.massiveAskWallDetected,
    massiveBidWallDetected: snapshot.massiveBidWallDetected,
    askWallPrice: snapshot.askWallPrice,
    bidWallPrice: snapshot.bidWallPrice,
    askWallVolume: snapshot.askWallVolume,
    bidWallVolume: snapshot.bidWallVolume
  });
  depthHistoryBySymbol.set(symbol, history.slice(-DEPTH_HISTORY_LIMIT));
}

function calculateDepthPersistence(symbol, currentSnapshot) {
  const history = pruneDepthHistory(symbol);
  if (!Array.isArray(history) || history.length < 3) {
    return {
      adjustment: 0,
      flags: [],
      persistence: {
        samples: history.length,
        bullishImbalancePct: 0,
        bearishImbalancePct: 0,
        bidWallPersistencePct: 0,
        askWallPersistencePct: 0,
        spoofRiskScore: 0
      }
    };
  }

  const bullishImbalanceCount = history.filter((item) => Number(item.bidAskVolumeRatio) >= 1.15).length;
  const bearishImbalanceCount = history.filter((item) => Number(item.bidAskVolumeRatio) <= 0.85).length;
  const bidWallSeen = history.filter((item) => item.massiveBidWallDetected).length;
  const askWallSeen = history.filter((item) => item.massiveAskWallDetected).length;

  const samples = history.length;
  const bullishImbalancePct = (bullishImbalanceCount / samples) * 100;
  const bearishImbalancePct = (bearishImbalanceCount / samples) * 100;
  const bidWallPersistencePct = (bidWallSeen / samples) * 100;
  const askWallPersistencePct = (askWallSeen / samples) * 100;

  const previous = history[samples - 2] || null;
  const nowHasAskWall = Boolean(currentSnapshot.massiveAskWallDetected);
  const nowHasBidWall = Boolean(currentSnapshot.massiveBidWallDetected);
  const disappearingAskWall = previous?.massiveAskWallDetected && !nowHasAskWall;
  const disappearingBidWall = previous?.massiveBidWallDetected && !nowHasBidWall;

  const spoofRiskScore = (disappearingAskWall || disappearingBidWall ? 50 : 0)
    + (Math.max(0, 60 - Math.max(bidWallPersistencePct, askWallPersistencePct)));

  let adjustment = 0;
  const flags = [];

  if (bullishImbalancePct >= 65) {
    adjustment += 4;
    flags.push('PERSISTENT_BID_PRESSURE');
  }
  if (bearishImbalancePct >= 65) {
    adjustment -= 4;
    flags.push('PERSISTENT_ASK_PRESSURE');
  }

  if (disappearingAskWall || disappearingBidWall) {
    adjustment -= 5;
    flags.push('DISAPPEARING_LIQUIDITY');
  }

  if (spoofRiskScore >= 75) {
    adjustment -= 4;
    flags.push('DEPTH_SPOOF_RISK');
  }

  return {
    adjustment,
    flags,
    persistence: {
      samples,
      bullishImbalancePct: Number(bullishImbalancePct.toFixed(2)),
      bearishImbalancePct: Number(bearishImbalancePct.toFixed(2)),
      bidWallPersistencePct: Number(bidWallPersistencePct.toFixed(2)),
      askWallPersistencePct: Number(askWallPersistencePct.toFixed(2)),
      spoofRiskScore: Number(spoofRiskScore.toFixed(2))
    }
  };
}

async function getOrderBookLiquidityForSignal(coin, currentPrice, trend) {
  try {
    const orderBook = await getOrderBook(coin, SIGNAL_DEPTH_LIMIT);
    const liquidity = analyzeOrderBookLiquidity(orderBook, currentPrice, trend);
    if (!liquidity) return null;

    addDepthSnapshot(coin, liquidity);
    const depthPersistence = calculateDepthPersistence(coin, liquidity);
    liquidity.depthPersistence = depthPersistence.persistence;
    liquidity.adjustment = depthPersistence.adjustment;
    liquidity.flags = depthPersistence.flags;

    console.log(
      `[ENGINE] ${coin} DEPTH -> ratio:${liquidity.bidAskVolumeRatio.toFixed(2)} | askWall:${liquidity.massiveAskWallDetected ? 'YES' : 'NO'} | persist:${liquidity.depthPersistence?.samples || 0} | block:${liquidity.blockedByLiquidity ? 'YES' : 'NO'}`
    );
    return liquidity;
  } catch (error) {
    console.log(`[ENGINE] ${coin} depth fetch failed (fail-open): ${error.message}`);
    return null;
  }
}

module.exports = {
  analyzeOrderBookLiquidity,
  getOrderBookLiquidityForSignal
};

