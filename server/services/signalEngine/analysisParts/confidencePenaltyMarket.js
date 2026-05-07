const { getTopCoins } = require('../../coingeckoService');

function calcRSIExtremePenalty(rsi) {
  if (rsi < 30 || rsi > 70) return -10;
  return 0;
}

/**
 * Calculate penalty for weak volume
 * @param {Object} volumeData - Volume check result
 * @returns {number} Penalty score (negative)
 */
function calcWeakVolumePenalty(volumeData) {
  if (!volumeData || volumeData.isBelowAvg) return -5;
  return 0;
}

/**
 * Calculate penalty for flat momentum
 * @param {number} momentum - Momentum percentage
 * @returns {number} Penalty score (negative)
 */
function calcFlatMomentumPenalty(momentum) {
  if (Math.abs(momentum) < 0.3) return -10;
  return 0;
}

/**
 * Calculate penalty for opposite short-term vs long-term momentum
 * @param {number} shortTermMomentum - Short-term momentum
 * @param {number} midTermMomentum - Mid-term momentum
 * @returns {number} Penalty score (negative)
 */
function calcMomentumConflictPenalty(shortTermMomentum, midTermMomentum) {
  if ((shortTermMomentum > 0 && midTermMomentum < 0) || (shortTermMomentum < 0 && midTermMomentum > 0)) {
    return -10;
  }
  return 0;
}

/**
 * Calculate total confidence penalty
 * Keep this layer momentum-focused to avoid double-counting RSI/Volume
 * (already captured inside technical score + weak-indicator penalty).
 * @param {Object} params - All indicator data
 * @returns {number} Total penalty score (negative)
 */
function calcConfidencePenalty(params) {
  const { momentum, shortTermMomentum, midTermMomentum } = params;
  const momentumPenalty = calcFlatMomentumPenalty(momentum);
  const conflictPenalty = calcMomentumConflictPenalty(shortTermMomentum, midTermMomentum);
  return momentumPenalty + conflictPenalty;
}

/**
 * Calculate market score based on 24h price change (max 30 points)
 * @param {string} coin - Coin symbol (e.g., BTCUSDT)
 * @param {string} trend - 'BUY' or 'SELL'
 * @returns {number} Market score (0-30)
 */
async function calcMarketScore(coin, trend, topCoins) {
  try {
    if (!topCoins) {
      topCoins = await getTopCoins(50);
    }
    const symbol = coin.replace('USDT', '').toLowerCase();
    const coinData = topCoins.find(c => c.symbol === symbol);

    if (!coinData || coinData.price_change_percentage_24h == null) return 15;

    const change24h = coinData.price_change_percentage_24h;

    if (trend === 'BUY' && change24h > 0) return Math.min(30, Math.round(change24h * 3));
    if (trend === 'SELL' && change24h < 0) return Math.min(30, Math.round(Math.abs(change24h) * 3));
    if (trend === 'BUY' && change24h < 0) return Math.max(0, Math.round(15 + change24h * 2));
    if (trend === 'SELL' && change24h > 0) return Math.max(0, Math.round(15 - change24h * 2));

    return 15;
  } catch {
    return 15;
  }
}

module.exports = {
  calcRSIExtremePenalty,
  calcWeakVolumePenalty,
  calcFlatMomentumPenalty,
  calcMomentumConflictPenalty,
  calcConfidencePenalty,
  calcMarketScore
};
