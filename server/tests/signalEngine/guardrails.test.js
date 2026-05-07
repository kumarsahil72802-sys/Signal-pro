const test = require('node:test');
const assert = require('node:assert/strict');

const { applyGuardrailPenalties } = require('../../services/signalEngine/generatorParts/guardrails');

test('applyGuardrailPenalties applies thin-depth and spread/slippage penalties', () => {
  const result = applyGuardrailPenalties({
    trend: 'BUY',
    btcTrend: 'STRONG_BEARISH',
    higherTimeframeTrend: { trend: 'bearish' },
    orderBookLiquidity: {
      bidQuoteVolume: 10000,
      askQuoteVolume: 15000,
      bidAskVolumeRatio: 0.5
    },
    executionQualityData: {
      spreadPct: 0.25,
      slippageRisk: 'HIGH'
    },
    macroTrends: {
      dxy: { direction: 'UP' },
      sp500: { direction: 'DOWN' }
    }
  });

  assert.ok(result.penalty < 0);
  assert.match(result.flags.join(','), /THIN_DEPTH/);
  assert.match(result.flags.join(','), /HIGH_SLIPPAGE_RISK/);
});

test('applyGuardrailPenalties stays neutral in healthy setup', () => {
  const result = applyGuardrailPenalties({
    trend: 'BUY',
    btcTrend: 'BULLISH',
    higherTimeframeTrend: { trend: 'bullish' },
    orderBookLiquidity: {
      bidQuoteVolume: 120000,
      askQuoteVolume: 130000,
      bidAskVolumeRatio: 1.02
    },
    executionQualityData: {
      spreadPct: 0.03,
      slippageRisk: 'LOW'
    },
    macroTrends: {
      dxy: { direction: 'DOWN' },
      sp500: { direction: 'UP' }
    }
  });

  assert.equal(result.penalty, 0);
});
