const { getOrderBook } = require('../../binanceService');
const { settings } = require('../config');

const {
  SIGNAL_ORDERBOOK_RANGE_PCT,
  SIGNAL_ORDERBOOK_NEAR_RANGE_PCT,
  SIGNAL_WHALE_WALL_MULTIPLIER,
  SIGNAL_WHALE_WALL_DOMINANCE,
  SIGNAL_DEPTH_LIMIT
} = settings;

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

async function getOrderBookLiquidityForSignal(coin, currentPrice, trend) {
  try {
    const orderBook = await getOrderBook(coin, SIGNAL_DEPTH_LIMIT);
    const liquidity = analyzeOrderBookLiquidity(orderBook, currentPrice, trend);
    if (!liquidity) return null;

    console.log(
      `[ENGINE] ${coin} DEPTH -> ratio:${liquidity.bidAskVolumeRatio.toFixed(2)} | askWall:${liquidity.massiveAskWallDetected ? 'YES' : 'NO'} | block:${liquidity.blockedByLiquidity ? 'YES' : 'NO'}`
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

