const mongoose = require('mongoose');

const signalSchema = new mongoose.Schema({
  coin: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: [/^(?:[A-Z]{2,10}|[0-9]{1,4}[A-Z]{2,10})USDT$/, 'Coin must be a valid USDT pair (e.g. BTCUSDT)']
  },
  type: { type: String, enum: ['BUY', 'SELL'], required: true },
  entryPrice: { type: Number, required: true, min: 0 },
  target: { type: Number, required: true, min: 0 },
  stopLoss: { type: Number, required: true, min: 0 },
  strength: { type: Number, required: true, min: 1, max: 100 },
  confidence: { type: Number, min: 0, max: 100, default: 0 },
  signalQuality: { type: String, enum: ['STRONG', 'GOOD', 'MODERATE', 'WEAK'], default: 'MODERATE' },
  confidenceBreakdown: {
    technical: { type: Number, default: 0 },
    market: { type: Number, default: 0 },
    sentiment: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    penalty: { type: Number, default: 0 }
  },
  sentimentScore: { type: Number, min: -1, max: 1, default: 0 },
  newsSummary: { type: String, default: '' },
  reason: {
    trend: { type: String, default: 'NEUTRAL' },
    momentum: { type: String, default: 'WEAK' },
    volume: { type: String, default: 'LOW' },
    rsi: { type: String, default: 'NEUTRAL' },
    macd: { type: String, default: 'NEUTRAL' },
    sentiment: { type: String, default: 'NEUTRAL' },
    rsiValue: { type: Number },
    deltaRatio: { type: String },
    volumeConfirmed: { type: String, default: 'NEUTRAL' },
    execution: { type: String, default: '' },
    slippageRisk: { type: String, default: '' },
    segment: { type: String, default: '' }
  },
  sentimentBreakdown: {
    status: { type: String, default: 'FALLBACK' },
    source: { type: String, default: 'fallback_neutral' },
    directionalScore: { type: Number, default: 0 },
    adjustment: { type: Number, default: 0 },
    articleCount: { type: Number, default: 0 },
    articleBias: { type: Number, default: 0 },
    macroBias: { type: Number, default: 0 }
  },
  segmentKey: { type: String, default: null, index: true },
  guardrailFlags: [{ type: String }],
  machineVersion: { type: String, default: 'winrate_v1' },
  trigger: {
    type: String,
    enum: ['EMA_TEST', 'EMA_ZONE', 'CROSSOVER', 'VOLATILITY_BREAKOUT', 'UNKNOWN'],
    default: 'UNKNOWN'
  },
  regime: { type: String, default: null },
  higherTimeframeTrend: { type: String, default: null },
  aiScore: { type: Number, min: 0, max: 100, default: null },
  aiConfidence: { type: Number, min: 0, max: 100, default: null },
  aiDecision: {
    type: String,
    enum: ['STRONG_APPROVE', 'APPROVE', 'WEAK_APPROVE', 'REJECT'],
    default: null
  },
  aiMessage: { type: String, default: null },
  groqInsight: { type: String, default: '' },
  nvidiaConfidence: { type: Number, min: 0, max: 100, default: null },
  nvidiaInsight: { type: String, default: '' },
  nvidiaStatus: {
    type: String,
    enum: ['SUCCESS', 'FALLBACK', 'SKIPPED'],
    default: 'SKIPPED'
  },
  nvidiaAttempts: { type: Number, default: 0, min: 0 },
  nvidiaError: { type: String, default: null },
  aiStatus: {
    type: String,
    enum: ['SUCCESS', 'FALLBACK', 'SKIPPED'],
    default: 'SKIPPED'
  },
  aiAttempts: { type: Number, default: 0, min: 0 },
  aiError: { type: String, default: null },
  status: {
    type: String,
    enum: ['ACTIVE', 'TAKEN', 'CLOSED'],
    default: 'ACTIVE'
  },
  result: {
    type: String,
    enum: ['PENDING', 'TARGET_HIT', 'SL_HIT', 'EXPIRED'],
    default: 'PENDING'
  },
  isMissedOpportunity: { type: Boolean, default: false },
  wasTaken: { type: Boolean, default: false },
  validUntil: { type: Date, default: null },
  missedAt: { type: Date },
  closedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  expireAt: {
    type: Date,
    default: null
  }
});

signalSchema.index(
  { expireAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: {
      $or: [
        { status: 'CLOSED', result: 'TARGET_HIT' },
        { status: 'CLOSED', result: 'SL_HIT' },
        { status: 'CLOSED', result: 'EXPIRED' }
      ]
    }
  }
);
signalSchema.index({ status: 1 });
signalSchema.index({ status: 1, validUntil: 1 });

module.exports = mongoose.model('Signal', signalSchema);
