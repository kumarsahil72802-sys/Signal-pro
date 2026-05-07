const Signal = require('../models/Signal');
const { settings } = require('../services/signalEngine/config');

const { SIGNAL_VALIDITY_MS } = settings;

function normalizeConfidence(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function resolveSignalValidUntil(signal) {
  if (!signal) return null;
  if (signal.validUntil) {
    const ts = new Date(signal.validUntil).getTime();
    if (Number.isFinite(ts)) return new Date(ts);
  }

  if (!signal.createdAt) return null;
  const createdTs = new Date(signal.createdAt).getTime();
  if (!Number.isFinite(createdTs)) return null;
  return new Date(createdTs + SIGNAL_VALIDITY_MS);
}

const createSignal = async (req, res) => {
  try {
    const { coin, type, entryPrice, target, stopLoss, strength } = req.body;

    if (!coin || !type || entryPrice == null || target == null || stopLoss == null || strength == null) {
      return res.status(400).json({ message: 'All fields are required: coin, type, entryPrice, target, stopLoss, strength' });
    }

    if (!['BUY', 'SELL'].includes(type)) {
      return res.status(400).json({ message: 'Type must be BUY or SELL' });
    }

    if (type === 'BUY') {
      if (target <= entryPrice) {
        return res.status(400).json({ message: 'For BUY signals, target must be above entry price' });
      }
      if (stopLoss >= entryPrice) {
        return res.status(400).json({ message: 'For BUY signals, stopLoss must be below entry price' });
      }
    } else {
      if (target >= entryPrice) {
        return res.status(400).json({ message: 'For SELL signals, target must be below entry price' });
      }
      if (stopLoss <= entryPrice) {
        return res.status(400).json({ message: 'For SELL signals, stopLoss must be above entry price' });
      }
    }

    const confidence = req.body.confidence ?? 0;
    const aiConfidence = normalizeConfidence(req.body.aiConfidence);

    if (confidence < 50) {
      console.log('Weak signal ignored');
      return res.status(200).json({ message: 'Weak signal ignored', confidence });
    }

    const signal = new Signal({
      coin: coin.toUpperCase().trim(),
      type,
      entryPrice,
      target,
      stopLoss,
      strength,
      confidence,
      aiConfidence,
      validUntil: new Date(Date.now() + SIGNAL_VALIDITY_MS)
    });

    await signal.save();
    console.log(`[API] Signal created: ${signal.coin} (${signal.type}) @ ${signal.confidence}% confidence`);
    res.status(201).json(signal);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getActiveSignals = async (req, res) => {
  try {
    const signals = await Signal.find({
      status: { $in: ['ACTIVE', 'TAKEN'] }
    }).sort({ confidence: -1, createdAt: -1 });
    res.json(signals);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getAllSignals = async (req, res) => {
  try {
    const signals = await Signal.find().sort({ confidence: -1, createdAt: -1 });
    res.json(signals);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const takeSignal = async (req, res) => {
  try {
    const signal = await Signal.findById(req.params.id);
    if (!signal) {
      return res.status(404).json({ message: 'Signal not found' });
    }

    if (signal.status !== 'ACTIVE') {
      return res.status(400).json({ message: `Signal is already ${signal.status}` });
    }

    const resolvedValidUntil = resolveSignalValidUntil(signal);
    if (!signal.validUntil && resolvedValidUntil) {
      signal.validUntil = resolvedValidUntil;
    }

    if (resolvedValidUntil && resolvedValidUntil.getTime() <= Date.now()) {
      const closedAt = new Date();
      signal.status = 'CLOSED';
      signal.result = 'EXPIRED';
      signal.closedAt = closedAt;
      signal.expireAt = new Date(closedAt.getTime() + 8 * 60 * 60 * 1000);
      await signal.save();
      return res.status(400).json({ message: 'Signal has already expired' });
    }

    signal.status = 'TAKEN';
    await signal.save();
    console.log(`[API] Signal taken: ${signal.coin} (${signal._id})`);
    res.json(signal);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid signal ID' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const missSignal = async (req, res) => {
  try {
    const signal = await Signal.findById(req.params.id);
    if (!signal) {
      return res.status(404).json({ message: 'Signal not found' });
    }

    if (signal.status !== 'ACTIVE') {
      return res.status(400).json({ message: `Signal is already ${signal.status}` });
    }

    const missedAt = new Date();
    signal.status = 'CLOSED';
    signal.result = 'TARGET_HIT';
    signal.isMissedOpportunity = true;
    signal.missedAt = missedAt;
    signal.expireAt = new Date(missedAt.getTime() + 8 * 60 * 60 * 1000);
    signal.closedAt = missedAt;
    await signal.save();
    console.log(`[API] Signal marked target-hit (not taken): ${signal.coin} (${signal._id})`);
    res.json(signal);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid signal ID' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * Get performance statistics using MongoDB aggregation
 * FIXED: Calculate win rate from TAKEN signals only
 * - TAKEN signals: user actually took these (win or loss)
 * - TARGET_HIT not-taken signals: user didn't take, target hit (separate metric)
 * - EXPIRED signals: time-based timeout closes (separate metric)
 */
const getStats = async (req, res) => {
  try {
    // Get total count of all signals ever generated
    const totalGenerated = await Signal.countDocuments();

    // FIXED: Aggregate stats for TAKEN signals only (wasTaken: true)
    // This is the ONLY set that should count toward win rate
    const stats = await Signal.aggregate([
      {
        $match: {
          wasTaken: true,
          result: { $in: ['TARGET_HIT', 'SL_HIT'] }
        }
      },
      {
        $group: {
          _id: null,
          totalTaken: { $sum: 1 },
          wins: {
            $sum: { $cond: [{ $eq: ['$result', 'TARGET_HIT'] }, 1, 0] }
          },
          losses: {
            $sum: { $cond: [{ $eq: ['$result', 'SL_HIT'] }, 1, 0] }
          },
          avgConfidence: { $avg: '$confidence' },
          avgRR: {
            $avg: {
              $cond: [
                { $eq: ['$result', 'TARGET_HIT'] },
                1.5,
                1
              ]
            }
          }
        }
      }
    ]);

    // Count target-hit opportunities (user didn't take, target hit)
    const totalMissed = await Signal.countDocuments({
      result: 'TARGET_HIT',
      wasTaken: false
    });

    // Count EXPIRED signals (timeout-based closes)
    const totalExpired = await Signal.countDocuments({
      status: 'CLOSED',
      result: 'EXPIRED'
    });

    // Get last 10 TAKEN signals for recent performance
    const last10Signals = await Signal.find({
      wasTaken: true,
      result: { $in: ['TARGET_HIT', 'SL_HIT'] }
    })
      .sort({ closedAt: -1 })
      .limit(10)
      .select('result coin type entryPrice target stopLoss closedAt');

    const last10Wins = last10Signals.filter(s => s.result === 'TARGET_HIT').length;
    const last10Total = last10Signals.length;
    const last10WinRate = last10Total > 0 ? (last10Wins / last10Total) * 100 : 0;

    // Aggregate per-coin stats for TAKEN signals only
    const coinStats = await Signal.aggregate([
      {
        $match: {
          wasTaken: true,
          result: { $in: ['TARGET_HIT', 'SL_HIT'] }
        }
      },
      {
        $group: {
          _id: '$coin',
          total: { $sum: 1 },
          wins: {
            $sum: { $cond: [{ $eq: ['$result', 'TARGET_HIT'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          coin: '$_id',
          total: 1,
          wins: 1,
          winRate: {
            $cond: [
              { $eq: ['$total', 0] },
              0,
              { $multiply: [{ $divide: ['$wins', '$total'] }, 100] }
            ]
          }
        }
      },
      { $sort: { winRate: -1 } }
    ]);

    // Extract overall stats
    const overall = stats[0] || {
      totalTaken: 0,
      wins: 0,
      losses: 0,
      avgConfidence: 0,
      avgRR: 0
    };

    const totalTaken = overall.totalTaken || 0;
    // FIXED: Win rate based ONLY on taken signals
    const winRate = totalTaken > 0 ? (overall.wins / totalTaken) * 100 : 0;
    const lossRate = totalTaken > 0 ? (overall.losses / totalTaken) * 100 : 0;

    // Calculate rates
    const missedRate = totalGenerated > 0 ? (totalMissed / totalGenerated) * 100 : 0;
    const takenRate = totalGenerated > 0 ? (totalTaken / totalGenerated) * 100 : 0;

    // Determine best and worst coins
    const bestCoin = coinStats.length > 0 ? coinStats[0].coin : null;
    const worstCoin = coinStats.length > 0 ? coinStats[coinStats.length - 1].coin : null;

    // FIXED: Include all new metrics in response
    res.json({
      // Legacy field (kept for backward compatibility)
      totalSignals: totalGenerated,
      wins: overall.wins || 0,
      losses: overall.losses || 0,
      winRate: Math.round(winRate * 10) / 10,
      lossRate: Math.round(lossRate * 10) / 10,
      avgRR: overall.avgRR ? Math.round(overall.avgRR * 10) / 10 : null,
      avgConfidence: overall.avgConfidence ? Math.round(overall.avgConfidence * 10) / 10 : 0,
      bestCoin,
      worstCoin,
      last10: {
        total: last10Total,
        wins: last10Wins,
        winRate: Math.round(last10WinRate * 10) / 10
      },
      // NEW fields for proper win rate calculation
      totalTaken,
      totalMissed,
      totalExpired,
      totalGenerated,
      missedRate: Math.round(missedRate * 10) / 10,
      takenRate: Math.round(takenRate * 10) / 10
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  createSignal,
  getActiveSignals,
  getAllSignals,
  takeSignal,
  missSignal,
  getStats
};
