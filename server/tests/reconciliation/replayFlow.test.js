const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveReplayOutcome,
  resolveSignalValidUntil
} = require('../../services/reconciliation/outcomeResolver');

test('replay flow: unresolved candles then expiry decision point exists', () => {
  const createdAt = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10h ago
  const signal = {
    type: 'BUY',
    target: 120,
    stopLoss: 80,
    createdAt
  };

  const replayResult = resolveReplayOutcome(signal, [], { ambiguityPolicy: 'CONSERVATIVE' });
  assert.equal(replayResult.resolved, false);

  const validUntil = resolveSignalValidUntil(signal);
  assert.ok(validUntil instanceof Date);
  assert.equal(Date.now() >= validUntil.getTime(), true);
});
