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

const EMERGENCY_COIN_CACHE_MS = 60 * 1000;

let cachedResolvedCoins = [];
let cachedCoinListUntil = 0;
let cachedTradableSymbols = new Set();
let cachedTradableSymbolsUntil = 0;
let cachedResolveMeta = {
  invalidFiltered: 0,
  invalidReplaced: 0,
  emergencyBtcOnly: false,
  tradableSet: new Set()
};

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

function cloneResolveMeta(meta) {
  return {
    invalidFiltered: Number(meta?.invalidFiltered || 0),
    invalidReplaced: Number(meta?.invalidReplaced || 0),
    emergencyBtcOnly: Boolean(meta?.emergencyBtcOnly),
    tradableSet: new Set(meta?.tradableSet || [])
  };
}

async function getTradableUsdtSymbolSet(options = {}) {
  const {
    forceRefresh = false,
    getTopUsdtSymbolsFn = getTopUsdtSymbols
  } = options;
  const now = Date.now();
  if (!forceRefresh && now < cachedTradableSymbolsUntil && cachedTradableSymbols.size > 0) {
    return cachedTradableSymbols;
  }

  const tradableSymbols = await getTopUsdtSymbolsFn({
    limit: TRADABLE_SYMBOL_FETCH_LIMIT,
    minQuoteVolume: 0,
    excludeStableBases: true
  });

  cachedTradableSymbols = new Set(tradableSymbols);
  cachedTradableSymbolsUntil = now + TRADABLE_SYMBOL_CACHE_MS;
  return cachedTradableSymbols;
}

async function resolveCoinsDetailed(topCoins = [], options = {}) {
  const {
    forceRefresh = false,
    nowMs = Date.now(),
    selector = COIN_SELECTOR,
    signalMaxCoins = SIGNAL_MAX_COINS,
    signalTopCoins = SIGNAL_TOP_COINS,
    minQuoteVolume = SIGNAL_MIN_24H_QUOTE_VOLUME_USDT,
    getTopUsdtSymbolsFn = getTopUsdtSymbols,
    getTopCoinsFn = getTopCoins,
    getTradableUsdtSymbolSetFn = getTradableUsdtSymbolSet
  } = options;

  if (!forceRefresh && nowMs < cachedCoinListUntil && cachedResolvedCoins.length > 0) {
    return {
      coins: [...cachedResolvedCoins],
      meta: cloneResolveMeta(cachedResolveMeta)
    };
  }

  let coins = [];
  let requestedCount = 0;

  if (selector === 'ALL') {
    coins = await getTopUsdtSymbolsFn({
      limit: signalMaxCoins,
      minQuoteVolume,
      excludeStableBases: true
    });
    requestedCount = Math.min(signalMaxCoins, coins.length || signalMaxCoins);
  } else {
    const topCount = parseTopSelector(selector);
    if (topCount) {
      requestedCount = Math.min(topCount, signalMaxCoins);
      const sourceTopCoins = topCoins.length > 0
        ? topCoins
        : await getTopCoinsFn(Math.max(signalTopCoins, requestedCount));

      coins = sourceTopCoins
        .map((coin) => normalizeCoinToken(String(coin.symbol || '')))
        .filter(Boolean)
        .slice(0, requestedCount);

      if (coins.length === 0) {
        console.log('[ENGINE] CoinGecko list unavailable for TOP selector, falling back to Binance top USDT symbols.');
        coins = await getTopUsdtSymbolsFn({
          limit: requestedCount,
          minQuoteVolume,
          excludeStableBases: true
        });
      }
    } else {
      coins = selector
        .split(',')
        .map(normalizeCoinToken)
        .filter(Boolean);
      requestedCount = Math.min(signalMaxCoins, coins.length);
    }
  }

  coins = filterStableBasePairs(dedupeCoins(coins)).slice(0, signalMaxCoins);
  requestedCount = Math.max(1, Math.min(signalMaxCoins, requestedCount || coins.length || 1));

  let resolveMeta = {
    invalidFiltered: 0,
    invalidReplaced: 0,
    emergencyBtcOnly: false,
    tradableSet: new Set()
  };

  try {
    const tradableSet = await getTradableUsdtSymbolSetFn({
      getTopUsdtSymbolsFn
    });
    resolveMeta.tradableSet = tradableSet;

    const validCoins = [];
    const invalidCoins = [];
    for (const symbol of coins) {
      if (tradableSet.has(symbol)) {
        validCoins.push(symbol);
      } else {
        invalidCoins.push(symbol);
      }
    }

    resolveMeta.invalidFiltered = invalidCoins.length;
    coins = validCoins;

    if (resolveMeta.invalidFiltered > 0) {
      console.log(`[ENGINE] Filtered out ${resolveMeta.invalidFiltered} non-tradable Binance pairs.`);
    }

    if (coins.length < requestedCount) {
      const topTradable = await getTopUsdtSymbolsFn({
        limit: TRADABLE_SYMBOL_FETCH_LIMIT,
        minQuoteVolume,
        excludeStableBases: true
      });
      const filteredTopTradable = filterStableBasePairs(dedupeCoins(topTradable));
      const currentSet = new Set(coins);
      for (const symbol of filteredTopTradable) {
        if (!tradableSet.has(symbol) || currentSet.has(symbol)) continue;
        coins.push(symbol);
        currentSet.add(symbol);
        resolveMeta.invalidReplaced += 1;
        if (coins.length >= requestedCount) break;
      }

      if (resolveMeta.invalidReplaced > 0) {
        console.log(`[ENGINE] Backfilled ${resolveMeta.invalidReplaced} tradable replacement pair(s).`);
      }
    }
  } catch (error) {
    coins = ['BTCUSDT'];
    resolveMeta = {
      invalidFiltered: 0,
      invalidReplaced: 0,
      emergencyBtcOnly: true,
      tradableSet: new Set(['BTCUSDT'])
    };
    cachedResolvedCoins = coins;
    cachedResolveMeta = cloneResolveMeta(resolveMeta);
    cachedCoinListUntil = nowMs + EMERGENCY_COIN_CACHE_MS;
    console.warn(`[ENGINE] EMERGENCY_BTC_ONLY -> tradable validation failed: ${error.message}`);
    return {
      coins: [...coins],
      meta: cloneResolveMeta(resolveMeta)
    };
  }

  if (coins.length === 0) {
    coins = ['BTCUSDT'];
    console.log('[ENGINE] Coin resolution returned empty list, falling back to BTCUSDT.');
    resolveMeta.tradableSet = new Set(['BTCUSDT']);
  }

  coins = coins.slice(0, requestedCount);

  cachedResolvedCoins = coins;
  cachedResolveMeta = cloneResolveMeta(resolveMeta);
  cachedCoinListUntil = nowMs + COIN_LIST_REFRESH_MS;
  return {
    coins: [...coins],
    meta: cloneResolveMeta(resolveMeta)
  };
}

async function resolveCoins(topCoins = [], options = {}) {
  const result = await resolveCoinsDetailed(topCoins, options);
  return result.coins;
}

function __resetCoinResolverCache() {
  cachedResolvedCoins = [];
  cachedCoinListUntil = 0;
  cachedTradableSymbols = new Set();
  cachedTradableSymbolsUntil = 0;
  cachedResolveMeta = {
    invalidFiltered: 0,
    invalidReplaced: 0,
    emergencyBtcOnly: false,
    tradableSet: new Set()
  };
}

module.exports = {
  parseTopSelector,
  normalizeCoinToken,
  dedupeCoins,
  filterStableBasePairs,
  getTradableUsdtSymbolSet,
  resolveCoins,
  resolveCoinsDetailed,
  __resetCoinResolverCache
};
