const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRiskSanity } = require('../../services/signalEngine/generatorParts/riskSanity');

test('evaluateRiskSanity passes realistic trending BUY envelope', () => {
  const result = evaluateRiskSanity({
    trend: 'BUY',
    entryPrice: 100,
    target: 106.2,
    stopLoss: 97,
    atr: 2,
    regime: 'TRENDING',
    supportResistance: {
      signalImpact: {
        nearestResistance: { price: 105.4 }
      }
    },
    confidence: 78
  });

  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
  assert.ok(result.metrics.rr >= 1.35);
});

test('evaluateRiskSanity rejects unrealistic target distance and too-tight stop', () => {
  const result = evaluateRiskSanity({
    trend: 'BUY',
    entryPrice: 100,
    target: 117,
    stopLoss: 99.6,
    atr: 2,
    regime: 'RANGING',
    supportResistance: {
      signalImpact: {
        nearestResistance: { price: 103 }
      }
    },
    confidence: 66
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('STOP_TOO_TIGHT'));
  assert.ok(result.issues.includes('UNREALISTIC_TARGET_DISTANCE'));
  assert.ok(result.issues.includes('TARGET_BEYOND_STRUCTURE_CAP'));
});

test('evaluateRiskSanity rejects SELL target far beyond support cap', () => {
  const result = evaluateRiskSanity({
    trend: 'SELL',
    entryPrice: 100,
    target: 92,
    stopLoss: 103,
    atr: 1.5,
    regime: 'LOW_VOLATILITY',
    supportResistance: {
      signalImpact: {
        nearestSupport: { price: 98.8 }
      }
    },
    confidence: 70
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('TARGET_BEYOND_STRUCTURE_CAP'));
});
