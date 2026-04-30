const mongoose = require('mongoose');

/**
 * Trade Schema - Optimized for storage efficiency
 * Uses compressed field names to minimize MongoDB Atlas free tier footprint
 */
const tradeSchema = new mongoose.Schema({
  c: { type: String, required: true, uppercase: true }, // coin symbol (BTCUSDT)
  s: { type: String, required: true },                 // setup type (BREAKOUT, EMA, etc)
  t: { type: Number, default: Date.now },              // timestamp

  // Indicators
  r: { type: Number }, // RSI
  v: { type: Number }, // volume ratio
  e: { type: Number }, // EMA slope
  a: { type: Number }, // ATR %
  b: { type: Number }, // BTC momentum

  // Scoring
  conf: { type: Number }, // base confidence
  ai: { type: Number },   // AI adjustment score

  // Result
  res: { 
    type: Number, 
    default: null, 
    enum: [1, -1, 0, null] // 1=WIN, -1=LOSS, 0=EXPIRED
  }
}, {
  versionKey: false, // Disable __v to save space
  timestamps: false  // We use 't' as our manual timestamp
});

// Indexes for performance and efficient queries
tradeSchema.index({ t: 1 });
tradeSchema.index({ c: 1, t: -1 });
tradeSchema.index({ res: 1 });

module.exports = mongoose.model('Trade', tradeSchema);
