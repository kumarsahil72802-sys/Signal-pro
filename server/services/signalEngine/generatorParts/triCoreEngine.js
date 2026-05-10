function toNumber(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeDecision(value, fallback = 'PARTIAL') {
  const normalized = String(value || '').trim().toUpperCase();
  if (['AGREE', 'PARTIAL', 'DISAGREE'].includes(normalized)) return normalized;
  return fallback;
}

function normalizeTradeDecision(value, fallback = 'WAIT') {
  const normalized = String(value || '').trim().toUpperCase();
  if (['TAKE', 'WAIT', 'SKIP'].includes(normalized)) return normalized;
  return fallback;
}

function normalizeAiValidation(raw = {}, provider = 'unknown') {
  const summary = String(raw.summary || '').trim();
  return {
    provider,
    ai_confidence: Number.isFinite(toNumber(raw.ai_confidence)) ? clamp(Math.round(toNumber(raw.ai_confidence)), 0, 100) : null,
    agreement_score: Number.isFinite(toNumber(raw.agreement_score)) ? clamp(Math.round(toNumber(raw.agreement_score)), 0, 100) : null,
    validator_decision: normalizeDecision(raw.validator_decision),
    trade_decision: normalizeTradeDecision(raw.trade_decision),
    major_contradictions: Array.isArray(raw.major_contradictions)
      ? raw.major_contradictions.map((item) => String(item).trim()).filter(Boolean)
      : [],
    minor_risks: Array.isArray(raw.minor_risks)
      ? raw.minor_risks.map((item) => String(item).trim()).filter(Boolean)
      : [],
    confidence_adjustment: clamp(Math.round(toNumber(raw.confidence_adjustment, 0)), -20, 20),
    target_price: Number.isFinite(toNumber(raw.target_price)) ? toNumber(raw.target_price) : null,
    stop_loss_price: Number.isFinite(toNumber(raw.stop_loss_price)) ? toNumber(raw.stop_loss_price) : null,
    summary: summary.split(/\s+/).filter(Boolean).slice(0, 30).join(' ')
  };
}

function buildUnavailableValidation(provider, reason = 'provider_unavailable') {
  return normalizeAiValidation({
    ai_confidence: null,
    agreement_score: null,
    validator_decision: 'PARTIAL',
    trade_decision: 'WAIT',
    major_contradictions: [],
    minor_risks: [reason],
    confidence_adjustment: -4,
    target_price: null,
    stop_loss_price: null,
    summary: `${provider} validation unavailable`
  }, provider);
}

function deriveBaseConfidence(machineConfidence, grok, nvidia) {
  const grokAvailable = Number.isFinite(grok.ai_confidence);
  const nvidiaAvailable = Number.isFinite(nvidia.ai_confidence);
  const weightedSum =
    machineConfidence * 0.6
    + (grokAvailable ? grok.ai_confidence * 0.2 : 0)
    + (nvidiaAvailable ? nvidia.ai_confidence * 0.2 : 0);
  const totalWeight = 0.6 + (grokAvailable ? 0.2 : 0) + (nvidiaAvailable ? 0.2 : 0);
  return totalWeight > 0 ? weightedSum / totalWeight : machineConfidence;
}

function hasTextMatch(items, pattern) {
  return items.some((item) => pattern.test(String(item || '').toLowerCase()));
}

function decideFinalTrade(context) {
  const {
    machineContext,
    machineConfidence,
    finalConfidence,
    grok,
    nvidia,
    majorContradictions,
    minorRisks,
    machineValidatorPassed
  } = context;

  const bothAiDisagree = grok.validator_decision === 'DISAGREE' && nvidia.validator_decision === 'DISAGREE';
  const oneAiDisagree = grok.validator_decision === 'DISAGREE' || nvidia.validator_decision === 'DISAGREE';
  const atLeastOneAgree = grok.validator_decision === 'AGREE' || nvidia.validator_decision === 'AGREE';

  const weakStructure = /WEAK|NEUTRAL/.test(String(machineContext?.marketStructure?.trend || '').toUpperCase());
  const weakAdx = ['VERY_WEAK', 'WEAK'].includes(String(machineContext?.adx?.trendStrength || '').toUpperCase());
  const fakeBreakoutHigh = String(machineContext?.supportResistance?.fakeBreakoutRisk || '').toUpperCase() === 'HIGH';
  const realizedRr = toNumber(machineContext?.riskModel?.realizedRR, 0);
  const executionHardReject = machineContext?.executionIntelligence?.hardReject === true;
  const poorRr = Number.isFinite(realizedRr) ? realizedRr < 1.2 : false;
  const spoofDanger = String(machineContext?.depth?.spoofRisk || '').toUpperCase() === 'HIGH';
  const riskModelAcceptable = Number.isFinite(realizedRr) ? realizedRr >= 1.25 : false;

  if (executionHardReject) return 'SKIP';
  if (bothAiDisagree) return 'SKIP';
  if (majorContradictions.length >= 3) return 'SKIP';
  if ((weakStructure && weakAdx) || fakeBreakoutHigh || poorRr || spoofDanger) return 'SKIP';

  const liquidityRisk = hasTextMatch(minorRisks, /(liquid|depth|spoof|slippage|spread)/);
  const contradictionExists = majorContradictions.length > 0 || minorRisks.length > 0;

  const takeConditions = (
    machineConfidence >= 70
    && atLeastOneAgree
    && majorContradictions.length === 0
    && machineValidatorPassed
    && riskModelAcceptable
    && finalConfidence >= 68
  );

  if (takeConditions) return 'TAKE';

  if (oneAiDisagree || contradictionExists || liquidityRisk || finalConfidence < 68) {
    return 'WAIT';
  }

  return 'WAIT';
}

function createTriCoreDecision(payload = {}) {
  const machineContext = payload.machineContext || {};
  const machineConfidence = clamp(Math.round(toNumber(machineContext.machineConfidence, 0)), 0, 100);
  const machineValidatorPassed = machineContext?.machineValidator?.passed !== false;

  const grok = payload.grokValidation
    ? normalizeAiValidation(payload.grokValidation, 'grok')
    : buildUnavailableValidation('grok');
  const nvidia = payload.nvidiaValidation
    ? normalizeAiValidation(payload.nvidiaValidation, 'nvidia')
    : buildUnavailableValidation('nvidia');

  const majorContradictions = [...grok.major_contradictions, ...nvidia.major_contradictions];
  const minorRisks = [...grok.minor_risks, ...nvidia.minor_risks];

  let finalConfidence = deriveBaseConfidence(machineConfidence, grok, nvidia);
  const adjustments = [];

  if (grok.validator_decision === 'AGREE' && nvidia.validator_decision === 'AGREE') {
    finalConfidence += 6;
    adjustments.push({ reason: 'dual_ai_agreement_boost', delta: 6 });
  }

  if (grok.validator_decision === 'DISAGREE' || nvidia.validator_decision === 'DISAGREE') {
    finalConfidence -= 10;
    adjustments.push({ reason: 'single_ai_disagreement_penalty', delta: -10 });
  }

  if (grok.validator_decision === 'DISAGREE' && nvidia.validator_decision === 'DISAGREE') {
    finalConfidence -= 20;
    adjustments.push({ reason: 'dual_ai_disagreement_penalty', delta: -20 });
  }

  if (majorContradictions.length >= 2) {
    const clusterPenalty = majorContradictions.length >= 4 ? -16 : -10;
    finalConfidence += clusterPenalty;
    adjustments.push({ reason: 'major_contradiction_cluster_penalty', delta: clusterPenalty });
  }

  const bothAiHaveConfidence = Number.isFinite(grok.ai_confidence) && Number.isFinite(nvidia.ai_confidence);
  if (machineConfidence >= 78 && bothAiHaveConfidence && grok.ai_confidence < 55 && nvidia.ai_confidence < 55) {
    finalConfidence -= 18;
    adjustments.push({ reason: 'machine_overconfidence_collapse', delta: -18 });
  }

  if (machineConfidence < 60 && bothAiHaveConfidence && grok.ai_confidence >= 70 && nvidia.ai_confidence >= 70) {
    finalConfidence += 4;
    adjustments.push({ reason: 'low_machine_high_ai_cap_wait', delta: 4 });
  }

  const regimeMismatch = hasTextMatch(majorContradictions, /(regime|policy mismatch|choppy|ranging)/);
  const cvdDivergence = String(machineContext?.cvd?.divergence || 'NONE').toUpperCase() !== 'NONE';
  if (regimeMismatch && cvdDivergence) {
    finalConfidence -= 14;
    adjustments.push({ reason: 'regime_mismatch_with_cvd_divergence', delta: -14 });
  }

  let reliabilityPenalty = 0;
  if (!Number.isFinite(grok.ai_confidence)) reliabilityPenalty += 8;
  if (!Number.isFinite(nvidia.ai_confidence)) reliabilityPenalty += 8;
  if (reliabilityPenalty > 0) {
    finalConfidence -= reliabilityPenalty;
    adjustments.push({ reason: 'ai_reliability_downgrade', delta: -reliabilityPenalty });
  }

  finalConfidence += grok.confidence_adjustment + nvidia.confidence_adjustment;
  adjustments.push({ reason: 'ai_confidence_adjustments', delta: grok.confidence_adjustment + nvidia.confidence_adjustment });

  finalConfidence = clamp(Math.round(finalConfidence), 0, 100);

  const agreementSamples = [grok.agreement_score, nvidia.agreement_score].filter((value) => Number.isFinite(value));
  const agreementScore = agreementSamples.length > 0
    ? Math.round(agreementSamples.reduce((sum, value) => sum + value, 0) / agreementSamples.length)
    : 50;

  let finalTradeDecision = decideFinalTrade({
    machineContext,
    machineConfidence,
    finalConfidence,
    grok,
    nvidia,
    majorContradictions,
    minorRisks,
    machineValidatorPassed
  });

  if (machineConfidence < 60 && finalTradeDecision === 'TAKE') {
    finalTradeDecision = 'WAIT';
    adjustments.push({ reason: 'low_machine_confidence_take_guard', delta: 0 });
  }

  const contradictionList = [...new Set([...majorContradictions, ...minorRisks])];

  return {
    finalConfidence,
    finalTradeDecision,
    agreementScore: clamp(agreementScore, 0, 100),
    contradictionList,
    majorContradictions,
    minorRisks,
    confidenceBreakdown: {
      machineWeight: 0.6,
      grokWeight: 0.2,
      nvidiaWeight: 0.2,
      machineConfidence,
      grokConfidence: grok.ai_confidence,
      nvidiaConfidence: nvidia.ai_confidence,
      adjustments
    },
    grok,
    nvidia,
    reliability: {
      missingValidators: Number(!Number.isFinite(grok.ai_confidence)) + Number(!Number.isFinite(nvidia.ai_confidence)),
      reliabilityPenalty
    },
    summary: `${finalTradeDecision} | FC:${finalConfidence} | AG:${agreementScore}`
  };
}

module.exports = {
  normalizeAiValidation,
  buildUnavailableValidation,
  createTriCoreDecision
};
