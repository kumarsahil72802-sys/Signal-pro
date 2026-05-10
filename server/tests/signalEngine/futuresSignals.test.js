const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyFuturesAdjustment,
  applyRealtimeAdjustment
} = require('../../services/signalEngine/analysisParts/futuresSignals');

test('applyFuturesAdjustment penalizes crowded long BUY setups', () => {
  const result = applyFuturesAdjustment('BUY', {
    fundingRate: 0.00035,
    openInterestTrendPct: 1.4,
    takerBuySellRatio: 1.2,
    longShortRatio: 1.25,
    topTraderPositionRatio: 1.55,
    topTraderAccountRatio: 1.48
  });

  assert.ok(result.adjustment < 0);
});

test('applyFuturesAdjustment boosts SELL when long crowd is stretched', () => {
  const result = applyFuturesAdjustment('SELL', {
    fundingRate: 0.00021,
    openInterestTrendPct: 1.1,
    takerBuySellRatio: 0.9,
    longShortRatio: 1.3,
    topTraderPositionRatio: 1.5,
    topTraderAccountRatio: 1.42
  });

  assert.ok(result.adjustment > 0);
});

test('applyRealtimeAdjustment rewards aligned BUY flow and penalizes wide spread', () => {
  const bullish = applyRealtimeAdjustment('BUY', {
    status: 'LIVE',
    stale: false,
    tradeImbalance1m: 0.25,
    spreadPct: 0.03,
    bookImbalancePct: 20,
    tradeCount1m: 30
  });

  const bearishNoise = applyRealtimeAdjustment('BUY', {
    status: 'LIVE',
    stale: false,
    tradeImbalance1m: -0.25,
    spreadPct: 0.2,
    bookImbalancePct: -20,
    tradeCount1m: 30
  });

  assert.ok(bullish.adjustment > 0);
  assert.ok(bearishNoise.adjustment < 0);
});
