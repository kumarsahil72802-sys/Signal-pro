const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enhancedAnalyze,
  parseAiEnrichmentPayload,
  parseAiValidatorPayload,
  buildEnrichmentPrompt,
  buildPerformanceContext
} = require('../../services/aiAnalyst');

function sampleSignal(overrides = {}) {
  return {
    coin: 'BTCUSDT',
    type: 'BUY',
    entryPrice: 100,
    target: 108,
    stopLoss: 95,
    confidence: 74,
    signalQuality: 'GOOD',
    trendStrength: 'STRONG',
    trigger: 'EMA_ZONE',
    regime: 'TRENDING',
    higherTimeframeTrend: 'bullish',
    rsi: 46,
    prevRsi: 44,
    sentimentScore: 0.2,
    volumeSpike: true,
    btcTrend: 'BULLISH',
    isLateEntry: false,
    newsSummary: 'Sentiment:0.200 (BULLISH)',
    reason: {
      trend: 'UPTREND',
      momentum: 'STRONG',
      volume: 'HIGH',
      rsi: 'BULLISH',
      macd: 'BULLISH',
      sentiment: 'BULLISH',
      execution: 'GOOD',
      slippageRisk: 'LOW',
      volumeConfirmed: 'BUY_DOMINANT',
      deltaRatio: '0.71'
    },
    confidenceBreakdown: {
      technical: 48,
      market: 22,
      sentiment: 0.2,
      bonus: 12,
      penalty: -8
    },
    indicators: {
      rsi: 46,
      prevRsi: 44,
      ema9: 101.2,
      ema21: 99.8,
      emaSlope: 0.18,
      emaProximity: 'INSIDE_ZONE',
      emaZone: 'BULL',
      macd: { macdLine: 0.42, signalLine: 0.28, histogram: 0.14 },
      atr: 1.2,
      atrPct: 1.1,
      bbUpper: 106,
      bbLower: 94,
      bbMiddle: 100,
      bbWidthPercent: 2.3,
      bbExpanding: true,
      volume: 120000,
      volumeAvg: 82000,
      volumeRatio: 1.46
    },
    supportResistance: {
      signalImpact: {
        nearestSupport: { price: 98, strength: 68 },
        nearestResistance: { price: 110, strength: 72 },
        flags: [],
        adjustment: 3
      }
    },
    marketStructure: {
      trendBias: 'BULLISH',
      reversalRisk: 'LOW',
      structureBreak: { bullishBreak: true, bearishBreak: false },
      summary: { highSequence: 'HH', lowSequence: 'HL' }
    },
    marketStructureSignal: {
      adjustment: 6,
      flags: ['STRUCTURE_ALIGNED']
    },
    adxContext: {
      adx: 27,
      strength: 'MODERATE',
      directionalAligned: true,
      flags: []
    },
    regimeContext: {
      regime: 'TRENDING',
      regimeScore: 78,
      policy: { confidenceFloor: 54 }
    },
    cvdContext: {
      cvd1m: 12345,
      cvd5m: 33550,
      cvd15m: 58210,
      divergence: 'NONE'
    },
    liquidationContext: {
      possibleShortSqueeze: false,
      possibleLongSqueeze: false,
      liquidationCascade: false,
      exhaustionMove: false
    },
    depthContext: {
      adjustment: 2,
      flags: []
    },
    orderBookLiquidity: {
      bidAskVolumeRatio: 1.22,
      depthPersistence: {
        samples: 5,
        spoofRiskScore: 22,
        bidWallPersistencePct: 64,
        askWallPersistencePct: 20
      }
    },
    futuresData: {
      fundingRate: 0.0001,
      longShortRatio: 1.12,
      takerBuySellRatio: 1.08,
      openInterestTrendPct: 3.2
    },
    realtimeContext: {
      tradeImbalance1m: 0.19,
      buyQuote1m: 400000,
      sellQuote1m: 260000
    },
    sentimentBreakdown: {
      source: 'news_aggregator'
    },
    riskModel: {
      realizedRR: 1.7
    },
    guardrailFlags: [],
    ...overrides
  };
}

test('parseAiValidatorPayload parses strict validator JSON payload', () => {
  const payload = parseAiValidatorPayload('{"ai_confidence": 81, "agreement_score": 77, "validator_decision":"AGREE", "trade_decision":"TAKE", "major_contradictions": [], "minor_risks":["near resistance"], "confidence_adjustment": 4, "target_price": 108.8, "stop_loss_price": 95.8, "summary":"Trend and flow aligned with acceptable risk."}');
  assert.equal(payload.ai_confidence, 81);
  assert.equal(payload.agreement_score, 77);
  assert.equal(payload.validator_decision, 'AGREE');
  assert.equal(payload.trade_decision, 'TAKE');
  assert.equal(payload.target_price, 108.8);
  assert.equal(payload.stop_loss_price, 95.8);
  assert.deepEqual(payload.major_contradictions, []);
});

test('parseAiEnrichmentPayload alias parses validator payload', () => {
  const payload = parseAiEnrichmentPayload('{"ai_confidence": 59, "agreement_score": 51, "validator_decision":"PARTIAL", "trade_decision":"WAIT", "major_contradictions":["weak adx"], "minor_risks":[], "confidence_adjustment":-5, "summary":"Weak trend quality."}');
  assert.equal(payload.validator_decision, 'PARTIAL');
  assert.equal(payload.trade_decision, 'WAIT');
  assert.equal(payload.confidence_adjustment, -5);
});

test('buildEnrichmentPrompt includes strict schema and machine context block', () => {
  const prompt = buildEnrichmentPrompt(
    sampleSignal(),
    { coin: 'BTCUSDT', machineConfidence: 74 },
    'Trigger(EMA_ZONE) W/L:7/3 WinRate:70.0%'
  );
  assert.match(prompt, /strict crypto signal validation engine/i);
  assert.match(prompt, /ai_confidence/);
  assert.match(prompt, /validator_decision/);
  assert.match(prompt, /target_price/);
  assert.match(prompt, /stop_loss_price/);
  assert.match(prompt, /Machine context JSON/);
});

test('buildPerformanceContext returns rate lines for trigger and symbol', () => {
  const context = buildPerformanceContext({
    triggerStats: { EMA_ZONE: { win: 6, loss: 4 } },
    triggerSymbolStats: { EMA_ZONE: { BTCUSDT: { win: 4, loss: 2 } } }
  }, sampleSignal({ trigger: 'EMA_ZONE', coin: 'BTCUSDT' }));

  assert.match(context, /Trigger\(EMA_ZONE\)/);
  assert.match(context, /Coin\+Trigger\(BTCUSDT\)/);
});

test('enhancedAnalyze runs TriCore and returns TAKE on dual AI agreement', async () => {
  const signal = sampleSignal();
  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => null,
    askGroqWithMeta: async () => ({
      text: '{"ai_confidence": 84, "agreement_score": 80, "validator_decision":"AGREE", "trade_decision":"TAKE", "major_contradictions": [], "minor_risks": [], "confidence_adjustment": 4, "target_price":108.8, "stop_loss_price":95.8, "summary":"Clean trend and supportive flow."}',
      attempts: 1,
      error: null
    }),
    askNvidiaWithMeta: async () => ({
      text: '{"ai_confidence": 82, "agreement_score": 78, "validator_decision":"AGREE", "trade_decision":"TAKE", "major_contradictions": [], "minor_risks": [], "confidence_adjustment": 3, "target_price":109.0, "stop_loss_price":95.9, "summary":"No material contradiction detected."}',
      attempts: 1,
      error: null
    })
  });

  assert.equal(result.aiStatus, 'SUCCESS');
  assert.equal(result.nvidiaStatus, 'SUCCESS');
  assert.equal(result.finalTradeDecision, 'TAKE');
  assert.equal(result.aiDecision, 'STRONG_APPROVE');
  assert.equal(result.groqTradeCall, 'TAKE');
  assert.equal(result.nvidiaTradeCall, 'TAKE');
  assert.ok(result.aiConfidence >= 70);
  assert.equal(result.aiRiskPlan?.applied, true);
  assert.equal(result.machineContext.coin, 'BTCUSDT');
});

test('enhancedAnalyze keeps flow alive when one validator fails', async () => {
  const signal = sampleSignal();
  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => null,
    askGroqWithMeta: async () => ({
      text: '{"ai_confidence": 79, "agreement_score": 70, "validator_decision":"AGREE", "trade_decision":"WAIT", "major_contradictions": [], "minor_risks": ["liquidity thin"], "confidence_adjustment": 0, "summary":"Structure okay with execution caution."}',
      attempts: 1,
      error: null
    }),
    askNvidiaWithMeta: async () => ({
      text: 'not_json',
      attempts: 2,
      error: 'nvidia_timeout'
    })
  });

  assert.equal(result.aiStatus, 'SUCCESS');
  assert.equal(result.nvidiaStatus, 'FALLBACK');
  assert.equal(result.nvidiaError, 'nvidia_timeout');
  assert.ok(['WAIT', 'SKIP'].includes(result.finalTradeDecision));
  assert.ok(result.aiConfidence <= 90);
});

test('enhancedAnalyze returns SKIP when both validators disagree', async () => {
  const signal = sampleSignal({ confidence: 82 });
  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => null,
    askGroqWithMeta: async () => ({
      text: '{"ai_confidence": 32, "agreement_score": 20, "validator_decision":"DISAGREE", "trade_decision":"SKIP", "major_contradictions": ["fake breakout risk"], "minor_risks": ["weak liquidity"], "confidence_adjustment": -10, "summary":"High contradiction cluster versus machine bias."}',
      attempts: 1,
      error: null
    }),
    askNvidiaWithMeta: async () => ({
      text: '{"ai_confidence": 28, "agreement_score": 16, "validator_decision":"DISAGREE", "trade_decision":"SKIP", "major_contradictions": ["regime mismatch"], "minor_risks": ["cvd divergence"], "confidence_adjustment": -12, "summary":"Trend quality unsupported across flow metrics."}',
      attempts: 1,
      error: null
    })
  });

  assert.equal(result.finalTradeDecision, 'SKIP');
  assert.equal(result.aiDecision, 'REJECT');
  assert.equal(result.groqTradeCall, 'SKIP');
  assert.equal(result.nvidiaTradeCall, 'SKIP');
  assert.ok(result.contradictionList.length >= 2);
});
