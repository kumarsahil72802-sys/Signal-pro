const Signal = require('../models/Signal');

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
      confidence
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
      status: { $in: ['ACTIVE', 'TAKEN', 'MISSED'] }
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

    signal.status = 'MISSED';
    await signal.save();
    console.log(`[API] Signal manually missed: ${signal.coin} (${signal._id})`);
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
 * - MISSED signals: user didn't take, target hit (separate metric)
 * - EXPIRED signals: user didn't take, SL hit or TTL expired (separate metric)
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

    // Count MISSED opportunities (user didn't take, target hit)
    const totalMissed = await Signal.countDocuments({
      status: 'MISSED',
      isMissedOpportunity: true
    });

    // Count EXPIRED signals (user didn't take, SL hit)
    const totalExpired = await Signal.countDocuments({
      status: 'CLOSED',
      wasTaken: false,
      result: 'SL_HIT'
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
      // Legacy fields (kept for backward compatibility)
      totalSignals: totalTaken,
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
