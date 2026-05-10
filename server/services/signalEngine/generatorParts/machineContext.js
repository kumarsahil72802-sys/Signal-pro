function toNumber(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
}

function pickRiskLevel(condition, highLabel = 'HIGH', lowLabel = 'LOW') {
  return condition ? highLabel : lowLabel;
}

function buildMachineContext(input = {}) {
  const {
    coin,
    trend,
    signalData,
    machineConfidence,
    technicalScore,
    marketScore,
    rsi,
    macdData,
    advancedSignal,
    atr,
    atrPct,
    bbData,
    bbWidthPercent,
    bbExpanding,
    volumeData,
    volumeDelta,
    srContext,
    adxContext,
    structureAnalysis,
    regimeContext,
    cvdContext,
    liquidationContext,
    orderBookLiquidity,
    depthContext,
    futuresData,
    realtimeContext,
    sentimentResult,
    sentimentScore,
    riskModel,
    rrAnalysis,
    executionIntelligence,
    tradeQualityGrade,
    riskGrade,
    validatorReasons,
    machineValidatorPassed,
    machineValidatorScore,
    machineValidatorDecision
  } = input;

  const srImpact = srContext?.signalImpact || {};
  const srFlags = srImpact.flags || [];
  const adxFlags = adxContext?.flags || [];
  const structureFlags = input.structureContext?.flags || [];
  const regimeFlags = regimeContext?.flags || [];
  const cvdFlags = cvdContext?.flags || [];
  const liquidationFlags = liquidationContext?.flags || [];
  const depthFlags = depthContext?.flags || [];

  const fakeBreakoutRisk = srFlags.includes('BUY_FAKE_BREAKOUT_RISK') || srFlags.includes('SELL_FAKE_BREAKOUT_RISK');
  const breakoutRisk = (srFlags.includes('BUY_NEAR_RESISTANCE') || srFlags.includes('SELL_NEAR_SUPPORT')) && !fakeBreakoutRisk;

  const flowStrengthRaw = toNumber(realtimeContext?.tradeImbalance1m, 0);
  const aggressiveBuyers = toNumber(realtimeContext?.buyQuote1m, 0);
  const aggressiveSellers = toNumber(realtimeContext?.sellQuote1m, 0);

  const depthPersistence = orderBookLiquidity?.depthPersistence || null;
  const spoofRiskScore = toNumber(depthPersistence?.spoofRiskScore, 0);

  const machineContext = {
    coin,
    signalType: trend,
    entry: round(signalData?.entryPrice, 8),
    target: round(signalData?.target, 8),
    stopLoss: round(signalData?.stopLoss, 8),

    machineConfidence: toNumber(machineConfidence, 0),
    technicalScore: round(technicalScore, 3),
    marketScore: round(marketScore, 3),

    indicators: {
      RSI: round(rsi, 3),
      MACD: {
        macdLine: round(macdData?.macdLine, 6),
        signalLine: round(macdData?.signalLine, 6),
        histogram: round(macdData?.histogram, 6)
      },
      EMA: {
        ema9: round(advancedSignal?.ema9, 8),
        ema21: round(advancedSignal?.ema21, 8),
        slope: round(advancedSignal?.slope, 5),
        proximity: advancedSignal?.proximity || null,
        zone: advancedSignal?.zone || null
      },
      ATR: {
        value: round(atr, 8),
        pct: round(atrPct, 4)
      },
      Bollinger: {
        upper: round(bbData?.upper, 8),
        lower: round(bbData?.lower, 8),
        middle: round(bbData?.middle, 8),
        widthPercent: round(bbWidthPercent, 4),
        expanding: Boolean(bbExpanding)
      },
      volume: {
        ratio: round(volumeData?.ratio, 4),
        current: round(volumeData?.current, 2),
        average: round(volumeData?.average, 2),
        isSpike: Boolean(volumeData?.isSpike),
        deltaRatio: round(volumeDelta?.deltaRatio, 4),
        buyDominant: Boolean(volumeDelta?.buyDominant),
        sellDominant: Boolean(volumeDelta?.sellDominant)
      }
    },

    supportResistance: {
      nearestSupport: srImpact.nearestSupport || null,
      nearestResistance: srImpact.nearestResistance || null,
      breakoutRisk: pickRiskLevel(breakoutRisk),
      fakeBreakoutRisk: pickRiskLevel(fakeBreakoutRisk),
      strength: round(
        Math.max(
          toNumber(srImpact?.nearestSupport?.strength, 0),
          toNumber(srImpact?.nearestResistance?.strength, 0)
        ),
        2
      )
    },

    adx: {
      value: round(adxContext?.adx, 3),
      trendStrength: adxContext?.strength || 'UNKNOWN',
      directionAlignment: Boolean(adxContext?.directionalAligned)
    },

    marketStructure: {
      trend: structureAnalysis?.trendBias || 'NEUTRAL',
      structureState: `${structureAnalysis?.summary?.highSequence || 'NA'}_${structureAnalysis?.summary?.lowSequence || 'NA'}`,
      structureBreak: structureAnalysis?.structureBreak || null,
      reversalRisk: structureAnalysis?.reversalRisk || 'UNKNOWN'
    },

    regime: {
      type: regimeContext?.regime || 'RANGING',
      confidence: round(regimeContext?.regimeScore, 2),
      policy: regimeContext?.policy || null
    },

    cvd: {
      alignment: cvdContext?.aligned ? 'ALIGNED' : 'MISALIGNED',
      divergence: cvdContext?.metrics?.divergence || (cvdContext?.divergence ? 'YES' : 'NONE'),
      pressure: round(realtimeContext?.tradeImbalance1m, 4),
      strength: round(cvdContext?.adjustment, 3)
    },

    liquidation: {
      squeezeRisk: pickRiskLevel(
        Boolean(liquidationContext?.possibleShortSqueeze) || Boolean(liquidationContext?.possibleLongSqueeze)
      ),
      exhaustionRisk: pickRiskLevel(Boolean(liquidationContext?.exhaustionMove)),
      cascadeRisk: pickRiskLevel(Boolean(liquidationContext?.liquidationCascade))
    },

    depth: {
      imbalance: round(orderBookLiquidity?.bidAskVolumeRatio, 4),
      spoofRisk: pickRiskLevel(spoofRiskScore >= 75),
      wallPersistence: depthPersistence
        ? {
            samples: toNumber(depthPersistence.samples, 0),
            bidWallPersistencePct: round(depthPersistence.bidWallPersistencePct, 2),
            askWallPersistencePct: round(depthPersistence.askWallPersistencePct, 2),
            spoofRiskScore: round(depthPersistence.spoofRiskScore, 2)
          }
        : null
    },

    futures: {
      funding: round(futuresData?.fundingRate, 8),
      OITrend: round(futuresData?.openInterestTrendPct, 4),
      longShortRatio: round(futuresData?.longShortRatio, 4),
      takerPressure: round(futuresData?.takerBuySellRatio, 4)
    },

    realtimeFlow: {
      aggressiveBuyers: round(aggressiveBuyers, 2),
      aggressiveSellers: round(aggressiveSellers, 2),
      flowStrength: round(flowStrengthRaw, 4)
    },

    newsSentiment: {
      label: sentimentResult?.label || 'NEUTRAL',
      score: round(sentimentScore, 4),
      source: sentimentResult?.source || 'unknown'
    },

    riskModel: riskModel || null,
    rrAnalysis: rrAnalysis || null,
    executionIntelligence: executionIntelligence ? {
      rrRatio: round(executionIntelligence?.rrAnalysis?.ratio, 3),
      hardReject: Boolean(executionIntelligence?.hardReject),
      decisionHint: executionIntelligence?.decisionHint || null,
      riskGrade: executionIntelligence?.riskGrade || riskGrade || null,
      baseTradeQualityGrade: executionIntelligence?.baseTradeQualityGrade || tradeQualityGrade || null,
      executionRealism: round(executionIntelligence?.scores?.executionRealism, 2),
      survivability: round(executionIntelligence?.scores?.survivability, 2),
      contradictionCount: toNumber(executionIntelligence?.contradictionCount, 0)
    } : null,
    tradeQualityGrade: tradeQualityGrade || null,
    riskGrade: riskGrade || null,
    validatorReasons: Array.isArray(validatorReasons) ? [...new Set(validatorReasons)] : [],
    machineValidator: {
      passed: Boolean(machineValidatorPassed),
      score: clamp(toNumber(machineValidatorScore, 0), 0, 100),
      decision: machineValidatorDecision || 'REJECT',
      flags: [...new Set([
        ...srFlags,
        ...adxFlags,
        ...structureFlags,
        ...regimeFlags,
        ...cvdFlags,
        ...liquidationFlags,
        ...depthFlags
      ])]
    }
  };

  return machineContext;
}

module.exports = {
  buildMachineContext
};
