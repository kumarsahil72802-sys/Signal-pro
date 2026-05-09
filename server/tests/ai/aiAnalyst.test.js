const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enhancedAnalyze,
  parseAiEnrichmentPayload,
  buildEnrichmentPrompt,
  buildPerformanceContext
} = require('../../services/aiAnalyst');

function sampleSignal(overrides = {}) {
  return {
    coin: 'BTCUSDT',
    type: 'BUY',
    entryPrice: 100,
    target: 110,
    stopLoss: 95,
    confidence: 62,
    signalQuality: 'WEAK',
    trendStrength: 'WEAK',
    trigger: 'EMA_ZONE',
    regime: 'RANGING',
    higherTimeframeTrend: 'bearish',
    rsi: 78,
    prevRsi: 75,
    sentimentScore: -0.2,
    volumeSpike: false,
    btcTrend: 'STRONG_BEARISH',
    isLateEntry: false,
    newsSummary: 'Sentiment:-0.200 (BEARISH)',
    reason: {
      trend: 'DOWNTREND',
      momentum: 'WEAK',
      volume: 'LOW',
      rsi: 'OVERBOUGHT',
      macd: 'BEARISH',
      sentiment: 'BEARISH',
      execution: 'RISKY',
      slippageRisk: 'HIGH',
      volumeConfirmed: 'SELL_DOMINANT',
      deltaRatio: '0.55'
    },
    confidenceBreakdown: {
      technical: 31,
      market: 14,
      sentiment: -0.2,
      bonus: 0,
      penalty: -8
    },
    macroTrends: {
      dxy: { trend: 'BULLISH', direction: 'UP', strength: 'STRONG', changePct: 0.42 },
      sp500: { trend: 'BEARISH', direction: 'DOWN', strength: 'MODERATE', changePct: -0.31 }
    },
    orderBookLiquidity: {
      bidAskVolumeRatio: 0.61,
      massiveAskWallDetected: true,
      blockedByLiquidity: true
    },
    ...overrides
  };
}

test('parseAiEnrichmentPayload parses strict JSON payload', () => {
  const payload = parseAiEnrichmentPayload('{"confidence_percent": 81, "risk_note": "Strong setup but watch resistance."}');
  assert.equal(payload.confidence, 81);
  assert.equal(payload.riskNote, 'Strong setup but watch resistance.');
});

test('parseAiEnrichmentPayload returns null for invalid payload', () => {
  const payload = parseAiEnrichmentPayload('not-json-payload');
  assert.equal(payload, null);
});

test('buildEnrichmentPrompt includes full-context and performance blocks', () => {
  const prompt = buildEnrichmentPrompt(
    sampleSignal(),
    'Full Signal Context Block',
    'Trigger(BUY) W/L:5/3 WinRate:62.5%'
  );
  assert.match(prompt, /Recent Strategy Performance:/);
  assert.match(prompt, /Full Signal Context:/);
  assert.match(prompt, /confidence_percent/);
  assert.match(prompt, /risk_note/);
});

test('buildPerformanceContext returns rate lines for trigger and symbol', () => {
  const context = buildPerformanceContext({
    triggerStats: { EMA_ZONE: { win: 6, loss: 4 } },
    triggerSymbolStats: { EMA_ZONE: { BTCUSDT: { win: 4, loss: 2 } } }
  }, sampleSignal({ trigger: 'EMA_ZONE', coin: 'BTCUSDT' }));

  assert.match(context, /Trigger\(EMA_ZONE\)/);
  assert.match(context, /Coin\+Trigger\(BTCUSDT\)/);
});

test('enhancedAnalyze keeps signal advisory when Groq and NVIDIA payloads fail (fail-open)', async () => {
  const signal = sampleSignal();
  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => null,
    askGroqWithMeta: async () => ({
      text: 'not_json',
      attempts: 3,
      error: 'timeout'
    }),
    askNvidiaWithMeta: async () => ({
      text: 'not_json',
      attempts: 2,
      error: 'nvidia_timeout'
    })
  });

  assert.ok(result);
  assert.equal(result.aiDecision, 'REJECT');
  assert.equal(result.aiStatus, 'FALLBACK');
  assert.equal(result.aiAttempts, 3);
  assert.equal(result.aiConfidence, signal.confidence);
  assert.equal(result.aiError, 'timeout');
  assert.equal(result.nvidiaStatus, 'FALLBACK');
  assert.equal(result.nvidiaAttempts, 2);
  assert.equal(result.nvidiaConfidence, null);
  assert.equal(result.nvidiaError, 'nvidia_timeout');
});

test('enhancedAnalyze keeps Groq primary and stores NVIDIA enrichment when both succeed', async () => {
  const signal = sampleSignal({ confidence: 74, trendStrength: 'STRONG', volumeSpike: true, rsi: 46 });
  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => ({
      triggerStats: { EMA_ZONE: { win: 7, loss: 3 } },
      triggerSymbolStats: { EMA_ZONE: { BTCUSDT: { win: 4, loss: 2 } } }
    }),
    askGroqWithMeta: async () => ({
      text: '{"confidence_percent": 83, "risk_note": "Momentum supports trend; risk is sudden macro reversal."}',
      attempts: 1,
      error: null
    }),
    askNvidiaWithMeta: async () => ({
      text: '{"confidence_percent": 79, "risk_note": "Liquidity stable; monitor macro headlines."}',
      attempts: 1,
      error: null
    })
  });

  assert.equal(result.aiStatus, 'SUCCESS');
  assert.equal(result.aiAttempts, 1);
  assert.equal(result.aiConfidence, 83);
  assert.match(result.groqInsight, /Momentum supports trend/);
  assert.equal(result.aiError, null);
  assert.equal(result.nvidiaStatus, 'SUCCESS');
  assert.equal(result.nvidiaAttempts, 1);
  assert.equal(result.nvidiaConfidence, 79);
  assert.match(result.nvidiaInsight, /Liquidity stable/);
  assert.equal(result.nvidiaError, null);
});

test('enhancedAnalyze keeps Groq decision path stable when NVIDIA fails', async () => {
  const signal = sampleSignal({ confidence: 71, trendStrength: 'STRONG', volumeSpike: true, rsi: 44 });
  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => null,
    askGroqWithMeta: async () => ({
      text: '{"confidence_percent": 76, "risk_note": "Structure valid, but protect downside."}',
      attempts: 1,
      error: null
    }),
    askNvidiaWithMeta: async () => ({
      text: 'not_json',
      attempts: 2,
      error: 'provider_error'
    })
  });

  assert.equal(result.aiStatus, 'SUCCESS');
  assert.equal(result.aiConfidence, 76);
  assert.equal(result.aiError, null);
  assert.equal(result.nvidiaStatus, 'FALLBACK');
  assert.equal(result.nvidiaConfidence, null);
  assert.equal(result.nvidiaAttempts, 2);
  assert.equal(result.nvidiaError, 'provider_error');
});

test('enhancedAnalyze skips Grok when machine confidence is below trigger threshold', async () => {
  const signal = sampleSignal({ confidence: 59 });
  let groqCalled = false;
  let nvidiaCalled = false;

  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => null,
    askGroqWithMeta: async () => {
      groqCalled = true;
      return {
        text: '{"confidence_percent": 90, "risk_note": "should not run"}',
        attempts: 1,
        error: null
      };
    },
    askNvidiaWithMeta: async () => {
      nvidiaCalled = true;
      return {
        text: '{"confidence_percent": 88, "risk_note": "should not run"}',
        attempts: 1,
        error: null
      };
    }
  });

  assert.equal(groqCalled, false);
  assert.equal(nvidiaCalled, false);
  assert.equal(result.aiStatus, 'SKIPPED');
  assert.equal(result.aiConfidence, 59);
  assert.equal(result.aiAttempts, 0);
  assert.equal(result.aiError, 'below_ai_trigger_confidence');
  assert.equal(result.nvidiaStatus, 'SKIPPED');
  assert.equal(result.nvidiaAttempts, 0);
  assert.equal(result.nvidiaError, 'below_ai_trigger_confidence');
});

test('enhancedAnalyze allows Grok when machine confidence equals trigger threshold', async () => {
  const signal = sampleSignal({ confidence: 60 });
  let groqCalled = false;
  let nvidiaCalled = false;

  const result = await enhancedAnalyze(signal, {
    analyzePerformance: async () => null,
    askGroqWithMeta: async () => {
      groqCalled = true;
      return {
        text: '{"confidence_percent": 67, "risk_note": "Threshold boundary call executed."}',
        attempts: 1,
        error: null
      };
    },
    askNvidiaWithMeta: async () => {
      nvidiaCalled = true;
      return {
        text: '{"confidence_percent": 64, "risk_note": "Boundary call executed for NVIDIA."}',
        attempts: 1,
        error: null
      };
    }
  });

  assert.equal(groqCalled, true);
  assert.equal(nvidiaCalled, true);
  assert.equal(result.aiStatus, 'SUCCESS');
  assert.equal(result.aiConfidence, 67);
  assert.equal(result.aiAttempts, 1);
  assert.equal(result.nvidiaStatus, 'SUCCESS');
  assert.equal(result.nvidiaConfidence, 64);
  assert.equal(result.nvidiaAttempts, 1);
});
