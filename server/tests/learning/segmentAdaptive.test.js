const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSegmentKey,
  getSegmentAdaptiveAdjustment
} = require('../../services/aiLearning');

test('buildSegmentKey includes trigger/regime/symbol/confidence-band', () => {
  const key = buildSegmentKey({
    trigger: 'EMA_ZONE',
    regime: 'TRENDING',
    symbol: 'BTCUSDT',
    confidence: 78
  });

  assert.equal(key, 'EMA_ZONE|TRENDING|BTCUSDT|HIGH');
});

test('getSegmentAdaptiveAdjustment requires minimum sample', () => {
  const segmentKey = 'EMA_ZONE|TRENDING|BTCUSDT|MID';
  const result = getSegmentAdaptiveAdjustment({
    segmentStats: {
      [segmentKey]: { win: 3, loss: 2, total: 5 }
    }
  }, segmentKey);

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'insufficient_segment_sample');
});

test('getSegmentAdaptiveAdjustment applies weak/strong penalties', () => {
  const weakKey = 'EMA_ZONE|RANGING|XRPUSDT|MID';
  const strongKey = 'CROSSOVER|TRENDING|ETHUSDT|HIGH';
  const performance = {
    segmentStats: {
      [weakKey]: { win: 2, loss: 8, total: 10 },
      [strongKey]: { win: 8, loss: 2, total: 10 }
    }
  };

  const weak = getSegmentAdaptiveAdjustment(performance, weakKey);
  const strong = getSegmentAdaptiveAdjustment(performance, strongKey);

  assert.equal(weak.applied, true);
  assert.ok(weak.adjustment < 0);
  assert.equal(strong.applied, true);
  assert.ok(strong.adjustment > 0);
});
