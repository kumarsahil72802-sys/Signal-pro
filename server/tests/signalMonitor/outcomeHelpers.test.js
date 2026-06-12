const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTargetHit,
  isStopLossHit
} = require('../../services/signalMonitor');

test('isTargetHit: BUY resolves at or above target', () => {
  const signal = { type: 'BUY', target: 110, stopLoss: 95 };

  assert.equal(isTargetHit(signal, 109.99), false);
  assert.equal(isTargetHit(signal, 110), true);
  assert.equal(isTargetHit(signal, 111), true);
});

test('isStopLossHit: BUY resolves at or below stop loss', () => {
  const signal = { type: 'BUY', target: 110, stopLoss: 95 };

  assert.equal(isStopLossHit(signal, 95.01), false);
  assert.equal(isStopLossHit(signal, 95), true);
  assert.equal(isStopLossHit(signal, 94), true);
});

test('isTargetHit: SELL resolves at or below target', () => {
  const signal = { type: 'SELL', target: 90, stopLoss: 105 };

  assert.equal(isTargetHit(signal, 90.01), false);
  assert.equal(isTargetHit(signal, 90), true);
  assert.equal(isTargetHit(signal, 89), true);
});

test('isStopLossHit: SELL resolves at or above stop loss', () => {
  const signal = { type: 'SELL', target: 90, stopLoss: 105 };

  assert.equal(isStopLossHit(signal, 104.99), false);
  assert.equal(isStopLossHit(signal, 105), true);
  assert.equal(isStopLossHit(signal, 106), true);
});
