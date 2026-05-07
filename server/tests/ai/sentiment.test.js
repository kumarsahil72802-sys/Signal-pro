const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcNewsSentiment,
  calculateSentimentAdjustment,
  scoreArticle,
  deriveMacroBias
} = require('../../services/signalEngine/analysisParts/sentiment');

test('calcNewsSentiment returns bounded structured output', async () => {
  const result = await calcNewsSentiment('BTCUSDT', { trend: 'BUY' });
  assert.ok(result);
  assert.equal(typeof result.score, 'number');
  assert.equal(typeof result.directionalScore, 'number');
  assert.ok(result.score <= 1 && result.score >= -1);
  assert.ok(result.directionalScore <= 1 && result.directionalScore >= -1);
});

test('scoreArticle yields bullish/neutral/bearish polarity', () => {
  const bullish = scoreArticle({ title: 'Bitcoin rally breakout and adoption surge' }, 'BTC');
  const bearish = scoreArticle({ title: 'Bitcoin crash selloff risk after lawsuit' }, 'BTC');
  const neutral = scoreArticle({ title: 'Bitcoin update announced', body: 'Community event' }, 'BTC');

  assert.ok(bullish > 0);
  assert.ok(bearish < 0);
  assert.equal(neutral, 0);
});

test('calculateSentimentAdjustment is bounded to +/-6', () => {
  assert.equal(calculateSentimentAdjustment(5), 6);
  assert.equal(calculateSentimentAdjustment(-5), -6);
  assert.ok(calculateSentimentAdjustment(0.2) > 0);
});

test('deriveMacroBias adjusts by trade direction', () => {
  const macro = {
    dxy: { direction: 'UP', strength: 'STRONG' },
    sp500: { direction: 'DOWN', strength: 'STRONG' }
  };

  const buyBias = deriveMacroBias(macro, 'BUY');
  const sellBias = deriveMacroBias(macro, 'SELL');

  assert.ok(buyBias < 0);
  assert.ok(sellBias > 0);
});
