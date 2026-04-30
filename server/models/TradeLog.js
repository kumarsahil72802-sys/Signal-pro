const mongoose = require('mongoose');

const tradeLogSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  type: { type: String, enum: ['BUY', 'SELL'], required: true },
  entryPrice: { type: Number, required: true },
  exitPrice: { type: Number },
  result: { type: String, enum: ['TARGET_HIT', 'SL_HIT', 'EXPIRED'], index: true },
  confidence: { type: Number },
  aiScore: { type: Number },
  regime: { type: String },
  trigger: { type: String, index: true },
  createdAt: { type: Date, default: Date.now }
});

tradeLogSchema.index({ createdAt: 1 });
tradeLogSchema.index({ trigger: 1, result: 1 });

module.exports = mongoose.model('TradeLog', tradeLogSchema);
