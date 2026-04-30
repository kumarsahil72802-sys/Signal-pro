const mongoose = require('mongoose');

const signalSchema = new mongoose.Schema({
  coin: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{2,10}USDT$/, 'Coin must be a valid USDT pair (e.g. BTCUSDT)']
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
  sentimentScore: { type: Number, min: 0, max: 20, default: 10 },
  reason: {
    trend: { type: String, default: 'NEUTRAL' },
    momentum: { type: String, default: 'WEAK' },
    volume: { type: String, default: 'LOW' },
    rsi: { type: String, default: 'NEUTRAL' },
    macd: { type: String, default: 'NEUTRAL' },
    sentiment: { type: String, default: 'NEUTRAL' }
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'TAKEN', 'MISSED', 'CLOSED'],
    default: 'ACTIVE'
  },
  result: {
    type: String,
    enum: ['PENDING', 'TARGET_HIT', 'SL_HIT'],
    default: 'PENDING'
  },
  isMissedOpportunity: { type: Boolean, default: false },
  wasTaken: { type: Boolean, default: false },
  missedAt: { type: Date },
  closedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  expireAt: {
    type: Date,
    default: () => new Date(Date.now() + 8 * 60 * 60 * 1000)
  }
});

signalSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
signalSchema.index({ status: 1 });

module.exports = mongoose.model('Signal', signalSchema);
