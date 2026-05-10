const test = require('node:test');
const assert = require('node:assert/strict');

const { createTriCoreDecision } = require('../../services/signalEngine/generatorParts/triCoreEngine');

function baseMachineContext(overrides = {}) {
  return {
    coin: 'BTCUSDT',
    signalType: 'BUY',
    machineConfidence: 76,
    supportResistance: { fakeBreakoutRisk: 'LOW' },
    marketStructure: { trend: 'BULLISH' },
    adx: { trendStrength: 'STRONG' },
    depth: { spoofRisk: 'LOW' },
    cvd: { divergence: 'NONE' },
    riskModel: { realizedRR: 1.7 },
    machineValidator: { passed: true },
    ...overrides
  };
}

test('TriCore boosts confidence on dual AGREE and returns TAKE in clean context', () => {
  const result = createTriCoreDecision({
    machineContext: baseMachineContext(),
    grokValidation: {
      ai_confidence: 82,
      agreement_score: 78,
      validator_decision: 'AGREE',
      trade_decision: 'TAKE',
      major_contradictions: [],
      minor_risks: [],
      confidence_adjustment: 4,
      summary: 'Aligned'
    },
    nvidiaValidation: {
      ai_confidence: 80,
      agreement_score: 74,
      validator_decision: 'AGREE',
      trade_decision: 'TAKE',
      major_contradictions: [],
      minor_risks: [],
      confidence_adjustment: 3,
      summary: 'Aligned'
    }
  });

  assert.equal(result.finalTradeDecision, 'TAKE');
  assert.ok(result.finalConfidence >= 75);
  assert.equal(result.majorContradictions.length, 0);
});

test('TriCore auto SKIP when both AIs disagree', () => {
  const result = createTriCoreDecision({
    machineContext: baseMachineContext({ machineConfidence: 84 }),
    grokValidation: {
      ai_confidence: 30,
      agreement_score: 22,
      validator_decision: 'DISAGREE',
      trade_decision: 'SKIP',
      major_contradictions: ['fake breakout risk'],
      minor_risks: [],
      confidence_adjustment: -10,
      summary: 'Bad'
    },
    nvidiaValidation: {
      ai_confidence: 27,
      agreement_score: 19,
      validator_decision: 'DISAGREE',
      trade_decision: 'SKIP',
      major_contradictions: ['regime mismatch'],
      minor_risks: [],
      confidence_adjustment: -8,
      summary: 'Bad'
    }
  });

  assert.equal(result.finalTradeDecision, 'SKIP');
  assert.ok(result.finalConfidence <= 45);
  assert.ok(result.majorContradictions.length >= 2);
});

test('TriCore downgrades reliability when one AI validator is unavailable', () => {
  const result = createTriCoreDecision({
    machineContext: baseMachineContext(),
    grokValidation: {
      ai_confidence: 74,
      agreement_score: 70,
      validator_decision: 'AGREE',
      trade_decision: 'WAIT',
      major_contradictions: [],
      minor_risks: [],
      confidence_adjustment: 0,
      summary: 'Okay'
    }
  });

  assert.equal(result.reliability.missingValidators, 1);
  assert.ok(result.confidenceBreakdown.adjustments.some((item) => item.reason === 'ai_reliability_downgrade'));
  assert.ok(['WAIT', 'SKIP', 'TAKE'].includes(result.finalTradeDecision));
});
