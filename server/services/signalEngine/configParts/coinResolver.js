const { getTopUsdtSymbols } = require('../../binanceService');
const { getTopCoins } = require('../../coingeckoService');
const { settings } = require('./settings');

const {
  COIN_SELECTOR,
  SIGNAL_MAX_COINS,
  SIGNAL_MIN_24H_QUOTE_VOLUME_USDT,
  SIGNAL_TOP_COINS,
  COIN_LIST_REFRESH_MS,
  TRADABLE_SYMBOL_CACHE_MS,
  TRADABLE_SYMBOL_FETCH_LIMIT,
  STABLE_BASE_ASSETS
} = settings;

let cachedResolvedCoins = [];
let cachedCoinListUntil = 0;
let cachedTradableSymbols = new Set();
let cachedTradableSymbolsUntil = 0;

function parseTopSelector(selector) {
  const match = selector.match(/^TOP(\d{1,3})$/);
  if (!match) return null;
  return Number(match[1]);
}

function normalizeCoinToken(token) {
  const normalized = token.trim().toUpperCase();
  if (!normalized) return null;
  if (/^[A-Z0-9]+USDT$/.test(normalized)) return normalized;
  if (/^[A-Z0-9]+$/.test(normalized)) return `${normalized}USDT`;
  return null;
}

function dedupeCoins(coins) {
  return [...new Set(coins)];
}

function filterStableBasePairs(coins) {
  return coins.filter((symbol) => {
    const base = symbol.replace(/USDT$/, '');
    return !STABLE_BASE_ASSETS.has(base);
  });
}

async function getTradableUsdtSymbolSet() {
  const now = Date.now();
  if (now < cachedTradableSymbolsUntil && cachedTradableSymbols.size > 0) {
    return cachedTradableSymbols;
  }

  const tradableSymbols = await getTopUsdtSymbols({
    limit: TRADABLE_SYMBOL_FETCH_LIMIT,
    minQuoteVolume: 0,
    excludeStableBases: true
  });

  cachedTradableSymbols = new Set(tradableSymbols);
  cachedTradableSymbolsUntil = now + TRADABLE_SYMBOL_CACHE_MS;
  return cachedTradableSymbols;
}

async function resolveCoins(topCoins = []) {
  const now = Date.now();
  if (now < cachedCoinListUntil && cachedResolvedCoins.length > 0) {
    return cachedResolvedCoins;
  }

  let coins = [];

  if (COIN_SELECTOR === 'ALL') {
    coins = await getTopUsdtSymbols({
      limit: SIGNAL_MAX_COINS,
      minQuoteVolume: SIGNAL_MIN_24H_QUOTE_VOLUME_USDT,
      excludeStableBases: true
    });
  } else {
    const topCount = parseTopSelector(COIN_SELECTOR);
    if (topCount) {
      const requestedCount = Math.min(topCount, SIGNAL_MAX_COINS);
      const sourceTopCoins = topCoins.length > 0
        ? topCoins
        : await getTopCoins(Math.max(SIGNAL_TOP_COINS, requestedCount));

      coins = sourceTopCoins
        .map((coin) => normalizeCoinToken(String(coin.symbol || '')))
        .filter(Boolean)
        .slice(0, requestedCount);

      if (coins.length === 0) {
        console.log('[ENGINE] CoinGecko list unavailable for TOP selector, falling back to Binance top USDT symbols.');
        coins = await getTopUsdtSymbols({
          limit: requestedCount,
          minQuoteVolume: SIGNAL_MIN_24H_QUOTE_VOLUME_USDT,
          excludeStableBases: true
        });
      }
    } else {
      coins = COIN_SELECTOR
        .split(',')
        .map(normalizeCoinToken)
        .filter(Boolean);
    }
  }

  coins = filterStableBasePairs(dedupeCoins(coins)).slice(0, SIGNAL_MAX_COINS);

  try {
    const tradableSet = await getTradableUsdtSymbolSet();
    const beforeCount = coins.length;
    coins = coins.filter((symbol) => tradableSet.has(symbol));
    const removedCount = beforeCount - coins.length;
    if (removedCount > 0) {
      console.log(`[ENGINE] Filtered out ${removedCount} non-tradable Binance pairs.`);
    }
  } catch (error) {
    console.log(`[ENGINE] Tradable symbol validation skipped: ${error.message}`);
  }

  if (coins.length === 0) {
    coins = ['BTCUSDT'];
    console.log('[ENGINE] Coin resolution returned empty list, falling back to BTCUSDT.');
  }

  cachedResolvedCoins = coins;
  cachedCoinListUntil = now + COIN_LIST_REFRESH_MS;
  return coins;
}

module.exports = {
  parseTopSelector,
  normalizeCoinToken,
  dedupeCoins,
  filterStableBasePairs,
  getTradableUsdtSymbolSet,
  resolveCoins
};
