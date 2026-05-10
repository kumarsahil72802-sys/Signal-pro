const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateExecutionIntelligence,
  finalizeExecutionDecision
} = require('../../services/signalEngine/generatorParts/executionIntelligenceEngine');

test('execution intelligence builds structure-aware tradable setup for healthy trending BUY', () => {
  const result = evaluateExecutionIntelligence({
    signalData: {
      entryPrice: 100,
      target: 108,
      stopLoss: 96
    },
    trend: 'BUY',
    currentPrice: 100,
    atr: 2,
    regimeContext: { regime: 'TRENDING' },
    supportResistance: {
      signalImpact: {
        nearestSupport: { price: 97.8, strength: 72 },
        nearestResistance: { price: 106.5, strength: 68 }
      }
    },
    marketStructure: {
      swings: {
        highs: [{ price: 106.2 }],
        lows: [{ price: 97.5 }]
      }
    },
    structureContext: { aligned: true },
    orderBookLiquidity: { blockedByLiquidity: false, flags: [] },
    liquidationContext: { flags: [] },
    depthContext: { flags: [] },
    volumeData: { ratio: 1.45 },
    momentum: 1.7,
    adxContext: { strength: 'STRONG' },
    executionQualityData: { executionQuality: 'GOOD', slippageRisk: 'LOW' }
  });

  assert.equal(result.hardReject, false);
  assert.ok(result.rrAnalysis.ratio >= 1.2);
  assert.equal(result.stop.quality, 'GOOD');
  assert.ok(['TAKE', 'WAIT'].includes(result.decisionHint));
});

test('execution intelligence rejects weak RR / unrealistic structure setup', () => {
  const result = evaluateExecutionIntelligence({
    signalData: {
      entryPrice: 100,
      target: 101,
      stopLoss: 80
    },
    trend: 'BUY',
    currentPrice: 100,
    atr: 2,
    regimeContext: { regime: 'RANGING' },
    supportResistance: {
      signalImpact: {
        nearestSupport: { price: 70, strength: 40 },
        nearestResistance: { price: 101.1, strength: 30 }
      }
    },
    marketStructure: { swings: { highs: [{ price: 101.2 }], lows: [{ price: 69.8 }] } },
    structureContext: { aligned: false },
    orderBookLiquidity: { blockedByLiquidity: true, flags: [] },
    liquidationContext: { flags: ['CASCADE_AGAINST_TREND'] },
    depthContext: { flags: ['DEPTH_SPOOF_RISK'] },
    volumeData: { ratio: 0.82 },
    momentum: 0.2,
    adxContext: { strength: 'WEAK' },
    executionQualityData: { executionQuality: 'RISKY', slippageRisk: 'HIGH' }
  });

  assert.equal(result.hardReject, true);
  assert.ok(result.rrAnalysis.ratio < 1.2);
  assert.equal(result.decisionHint, 'SKIP');
});

test('final execution decision escalates to TAKE only when triCore and execution quality align', () => {
  const executionIntelligence = {
    hardReject: false,
    contradictionCount: 0,
    rrAnalysis: { ratio: 1.8 },
    scores: {
      rrQuality: 82,
      executionRealism: 78,
      survivability: 76
    }
  };

  const finalDecision = finalizeExecutionDecision({
    executionIntelligence,
    triCore: {
      finalConfidence: 81,
      finalTradeDecision: 'TAKE',
      agreementScore: 72,
      majorContradictions: [],
      minorRisks: []
    }
  });

  assert.equal(finalDecision.finalDecision, 'TAKE');
  assert.ok(['A+', 'A', 'B'].includes(finalDecision.tradeQualityGrade));
});

test('final execution decision forces SKIP on hard reject contexts', () => {
  const finalDecision = finalizeExecutionDecision({
    executionIntelligence: {
      hardReject: true,
      contradictionCount: 3,
      rrAnalysis: { ratio: 0.9 },
      scores: {
        rrQuality: 30,
        executionRealism: 28,
        survivability: 34
      }
    },
    triCore: {
      finalConfidence: 77,
      finalTradeDecision: 'TAKE',
      agreementScore: 65,
      majorContradictions: [],
      minorRisks: []
    }
  });

  assert.equal(finalDecision.finalDecision, 'SKIP');
  assert.equal(finalDecision.tradeQualityGrade, 'REJECTED');
});
