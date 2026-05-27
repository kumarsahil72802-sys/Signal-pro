const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCoinsDetailed,
  __resetCoinResolverCache
} = require('../../services/signalEngine/configParts/coinResolver');

test('resolveCoinsDetailed filters invalid symbols and backfills to requested TOP count', async () => {
  __resetCoinResolverCache();

  const topCoins = [
    { symbol: 'btc' },
    { symbol: 'eth' },
    { symbol: 'htx' },
    { symbol: 'usdf' },
    { symbol: 'sol' }
  ];
  const tradableSet = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT']);
  const tradableRanked = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'];

  const result = await resolveCoinsDetailed(topCoins, {
    forceRefresh: true,
    selector: 'TOP5',
    signalMaxCoins: 10,
    signalTopCoins: 5,
    minQuoteVolume: 0,
    getTradableUsdtSymbolSetFn: async () => tradableSet,
    getTopUsdtSymbolsFn: async () => tradableRanked
  });

  assert.deepEqual(result.coins, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT']);
  assert.equal(result.meta.invalidFiltered, 2);
  assert.equal(result.meta.invalidReplaced, 2);
  assert.equal(result.meta.emergencyBtcOnly, false);
});

test('resolveCoinsDetailed preserves dedupe and never leaks invalid symbols', async () => {
  __resetCoinResolverCache();

  const topCoins = [
    { symbol: 'btc' },
    { symbol: 'btc' },
    { symbol: 'htx' },
    { symbol: 'eth' }
  ];
  const tradableSet = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']);
  const tradableRanked = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

  const result = await resolveCoinsDetailed(topCoins, {
    forceRefresh: true,
    selector: 'TOP4',
    signalMaxCoins: 10,
    signalTopCoins: 4,
    minQuoteVolume: 0,
    getTradableUsdtSymbolSetFn: async () => tradableSet,
    getTopUsdtSymbolsFn: async () => tradableRanked
  });

  assert.equal(result.coins.length, 4);
  assert.equal(new Set(result.coins).size, result.coins.length);
  assert.equal(result.coins.includes('HTXUSDT'), false);
  assert.equal(result.meta.invalidFiltered, 1);
  assert.equal(result.meta.invalidReplaced, 2);
});

test('resolveCoinsDetailed enters EMERGENCY_BTC_ONLY when tradable validation fails', async () => {
  __resetCoinResolverCache();

  const topCoins = [
    { symbol: 'btc' },
    { symbol: 'eth' },
    { symbol: 'sol' }
  ];

  const result = await resolveCoinsDetailed(topCoins, {
    forceRefresh: true,
    selector: 'TOP3',
    signalMaxCoins: 10,
    signalTopCoins: 3,
    minQuoteVolume: 0,
    getTradableUsdtSymbolSetFn: async () => {
      throw new Error('tradable_endpoint_down');
    },
    getTopUsdtSymbolsFn: async () => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  });

  assert.deepEqual(result.coins, ['BTCUSDT']);
  assert.equal(result.meta.emergencyBtcOnly, true);
  assert.equal(result.meta.invalidFiltered, 0);
  assert.equal(result.meta.invalidReplaced, 0);
});
