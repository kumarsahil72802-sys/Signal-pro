const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveReplayOutcome,
  resolveSignalValidUntil
} = require('../../services/reconciliation/outcomeResolver');

function candle({ openTime, high, low, closeTime }) {
  return {
    openTime,
    closeTime: closeTime ?? openTime + 60_000,
    high,
    low
  };
}

test('resolveReplayOutcome: target-only hit resolves TARGET_HIT', () => {
  const signal = { type: 'BUY', target: 110, stopLoss: 95 };
  const candles = [
    candle({ openTime: 1, high: 109, low: 100 }),
    candle({ openTime: 2, high: 111, low: 101 })
  ];

  const result = resolveReplayOutcome(signal, candles, { ambiguityPolicy: 'CONSERVATIVE' });
  assert.equal(result.resolved, true);
  assert.equal(result.result, 'TARGET_HIT');
});

test('resolveReplayOutcome: stop-only hit resolves SL_HIT', () => {
  const signal = { type: 'BUY', target: 110, stopLoss: 95 };
  const candles = [candle({ openTime: 1, high: 100, low: 94 })];

  const result = resolveReplayOutcome(signal, candles, { ambiguityPolicy: 'CONSERVATIVE' });
  assert.equal(result.resolved, true);
  assert.equal(result.result, 'SL_HIT');
});

test('resolveReplayOutcome: same candle both hits uses conservative SL-first policy', () => {
  const signal = { type: 'BUY', target: 110, stopLoss: 95 };
  const candles = [candle({ openTime: 1, high: 111, low: 94 })];

  const result = resolveReplayOutcome(signal, candles, { ambiguityPolicy: 'CONSERVATIVE' });
  assert.equal(result.resolved, true);
  assert.equal(result.result, 'SL_HIT');
  assert.equal(result.ambiguousCount, 1);
});

test('resolveReplayOutcome: no hit keeps unresolved', () => {
  const signal = { type: 'SELL', target: 90, stopLoss: 105 };
  const candles = [candle({ openTime: 1, high: 102, low: 92 })];

  const result = resolveReplayOutcome(signal, candles, { ambiguityPolicy: 'CONSERVATIVE' });
  assert.equal(result.resolved, false);
  assert.equal(result.result, null);
});

test('resolveReplayOutcome: SELL target-only hit resolves TARGET_HIT', () => {
  const signal = { type: 'SELL', target: 90, stopLoss: 105 };
  const candles = [candle({ openTime: 1, high: 101, low: 89 })];

  const result = resolveReplayOutcome(signal, candles, { ambiguityPolicy: 'CONSERVATIVE' });
  assert.equal(result.resolved, true);
  assert.equal(result.result, 'TARGET_HIT');
});

test('resolveReplayOutcome: SELL stop-only hit resolves SL_HIT', () => {
  const signal = { type: 'SELL', target: 90, stopLoss: 105 };
  const candles = [candle({ openTime: 1, high: 106, low: 91 })];

  const result = resolveReplayOutcome(signal, candles, { ambiguityPolicy: 'CONSERVATIVE' });
  assert.equal(result.resolved, true);
  assert.equal(result.result, 'SL_HIT');
});

test('resolveSignalValidUntil: falls back to createdAt + default validity', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const signal = { createdAt };
  const validUntil = resolveSignalValidUntil(signal);
  assert.ok(validUntil instanceof Date);
  assert.equal(validUntil.getTime() > createdAt.getTime(), true);
});
