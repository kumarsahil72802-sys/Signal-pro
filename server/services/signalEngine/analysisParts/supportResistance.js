function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(digits));
}

function computePivotPoints(klines, lookback = 2) {
  if (!Array.isArray(klines) || klines.length < (lookback * 2 + 1)) return { highs: [], lows: [] };

  const highs = [];
  const lows = [];

  for (let i = lookback; i < klines.length - lookback; i += 1) {
    const currentHigh = toNumber(klines[i].high);
    const currentLow = toNumber(klines[i].low);

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      if (toNumber(klines[j].high) >= currentHigh) isSwingHigh = false;
      if (toNumber(klines[j].low) <= currentLow) isSwingLow = false;
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) {
      highs.push({
        index: i,
        price: currentHigh,
        volume: toNumber(klines[i].volume),
        side: 'resistance'
      });
    }

    if (isSwingLow) {
      lows.push({
        index: i,
        price: currentLow,
        volume: toNumber(klines[i].volume),
        side: 'support'
      });
    }
  }

  return { highs, lows };
}

function buildZones(points, volumeAverage, priceTolerancePct = 0.35) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];

  for (const point of sorted) {
    const tolerance = point.price * (priceTolerancePct / 100);
    const match = clusters.find((cluster) => Math.abs(cluster.center - point.price) <= tolerance);

    if (!match) {
      clusters.push({
        side: point.side,
        center: point.price,
        prices: [point.price],
        touches: 1,
        rejections: 0,
        weightedVolume: point.volume,
        maxVolume: point.volume,
        firstIndex: point.index,
        lastIndex: point.index
      });
      continue;
    }

    match.prices.push(point.price);
    match.touches += 1;
    match.weightedVolume += point.volume;
    match.maxVolume = Math.max(match.maxVolume, point.volume);
    match.lastIndex = Math.max(match.lastIndex, point.index);
    match.firstIndex = Math.min(match.firstIndex, point.index);
    match.center = match.prices.reduce((sum, value) => sum + value, 0) / match.prices.length;
  }

  return clusters.map((zone) => {
    const volumeFactor = volumeAverage > 0 ? zone.weightedVolume / (volumeAverage * Math.max(zone.touches, 1)) : 1;
    const rejectionFactor = zone.rejections;
    const persistence = Math.max(0, zone.lastIndex - zone.firstIndex);

    const strength = clamp(
      (zone.touches * 8) + (Math.min(2.5, volumeFactor) * 12) + (Math.min(8, persistence / 3)) + rejectionFactor,
      8,
      100
    );

    return {
      side: zone.side,
      price: round(zone.center, 6),
      touches: zone.touches,
      weightedVolume: round(zone.weightedVolume, 2),
      avgVolumeFactor: round(volumeFactor, 3),
      persistence,
      strength: round(strength, 2)
    };
  }).sort((a, b) => b.strength - a.strength);
}

function detectRejections(klines, zones, proximityPct = 0.3) {
  if (!Array.isArray(klines) || klines.length === 0 || !Array.isArray(zones)) return zones || [];

  const updated = zones.map((zone) => ({ ...zone, rejectionCount: 0, fakeBreakouts: 0, breakoutCount: 0 }));

  for (const candle of klines) {
    const high = toNumber(candle.high);
    const low = toNumber(candle.low);
    const close = toNumber(candle.close);

    for (const zone of updated) {
      const threshold = zone.price * (proximityPct / 100);
      const touched = (zone.side === 'resistance' && high >= (zone.price - threshold))
        || (zone.side === 'support' && low <= (zone.price + threshold));

      if (!touched) continue;

      if (zone.side === 'resistance') {
        if (close < zone.price && high > zone.price) {
          zone.rejectionCount += 1;
          zone.fakeBreakouts += 1;
        } else if (close > zone.price) {
          zone.breakoutCount += 1;
        }
      } else if (zone.side === 'support') {
        if (close > zone.price && low < zone.price) {
          zone.rejectionCount += 1;
          zone.fakeBreakouts += 1;
        } else if (close < zone.price) {
          zone.breakoutCount += 1;
        }
      }
    }
  }

  return updated.map((zone) => {
    const strengthBoost = zone.rejectionCount * 3 + zone.breakoutCount * 2;
    return {
      ...zone,
      strength: round(clamp(zone.strength + strengthBoost, 8, 100), 2)
    };
  }).sort((a, b) => b.strength - a.strength);
}

function pickNearestZone(zones, side, currentPrice) {
  if (!Array.isArray(zones) || zones.length === 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const filtered = zones.filter((zone) => zone.side === side);
  if (filtered.length === 0) return null;

  if (side === 'resistance') {
    const above = filtered.filter((zone) => zone.price >= currentPrice).sort((a, b) => a.price - b.price);
    return above[0] || filtered.sort((a, b) => b.price - a.price)[0];
  }

  const below = filtered.filter((zone) => zone.price <= currentPrice).sort((a, b) => b.price - a.price);
  return below[0] || filtered.sort((a, b) => a.price - b.price)[0];
}

function deriveDynamicLevels(closes, ema9, ema21) {
  const currentPrice = toNumber(closes[closes.length - 1]);
  const emaSpread = Math.abs(ema9 - ema21);
  const dynamicMid = (ema9 + ema21) / 2;

  return {
    dynamicSupport: Math.min(dynamicMid, currentPrice - (emaSpread * 0.4)),
    dynamicResistance: Math.max(dynamicMid, currentPrice + (emaSpread * 0.4)),
    dynamicMid
  };
}

function evaluateSupportResistanceForSignal(context = {}) {
  const {
    trend,
    currentPrice,
    trigger,
    volumeData,
    zones,
    dynamicLevels,
    recentClose,
    recentHigh,
    recentLow
  } = context;

  const nearestResistance = pickNearestZone(zones, 'resistance', currentPrice);
  const nearestSupport = pickNearestZone(zones, 'support', currentPrice);

  let adjustment = 0;
  const flags = [];

  const resistanceDistancePct = nearestResistance
    ? ((nearestResistance.price - currentPrice) / currentPrice) * 100
    : null;
  const supportDistancePct = nearestSupport
    ? ((currentPrice - nearestSupport.price) / currentPrice) * 100
    : null;

  if (trend === 'BUY' && Number.isFinite(resistanceDistancePct) && resistanceDistancePct >= 0 && resistanceDistancePct <= 0.45) {
    const penalty = resistanceDistancePct <= 0.2 ? -10 : resistanceDistancePct <= 0.35 ? -7 : -4;
    adjustment += penalty;
    flags.push('BUY_NEAR_RESISTANCE');
  }

  if (trend === 'SELL' && Number.isFinite(supportDistancePct) && supportDistancePct >= 0 && supportDistancePct <= 0.45) {
    const penalty = supportDistancePct <= 0.2 ? -10 : supportDistancePct <= 0.35 ? -7 : -4;
    adjustment += penalty;
    flags.push('SELL_NEAR_SUPPORT');
  }

  const volumeStrong = Number(volumeData?.ratio || 0) >= 1.35;
  const breakoutCandidate = trigger === 'VOLATILITY_BREAKOUT' || trigger === 'CROSSOVER';

  if (trend === 'BUY' && nearestResistance && recentClose > nearestResistance.price && volumeStrong && breakoutCandidate) {
    adjustment += 8;
    flags.push('RESISTANCE_BREAKOUT_CONFIRMED');
  }

  if (trend === 'SELL' && nearestSupport && recentClose < nearestSupport.price && volumeStrong && breakoutCandidate) {
    adjustment += 8;
    flags.push('SUPPORT_BREAKDOWN_CONFIRMED');
  }

  if (trend === 'BUY' && nearestResistance && recentHigh > nearestResistance.price && recentClose < nearestResistance.price) {
    adjustment -= 9;
    flags.push('BUY_FAKE_BREAKOUT_RISK');
  }

  if (trend === 'SELL' && nearestSupport && recentLow < nearestSupport.price && recentClose > nearestSupport.price) {
    adjustment -= 9;
    flags.push('SELL_FAKE_BREAKOUT_RISK');
  }

  if (Number.isFinite(dynamicLevels?.dynamicSupport) && trend === 'BUY' && currentPrice >= dynamicLevels.dynamicSupport) {
    adjustment += 2;
  }
  if (Number.isFinite(dynamicLevels?.dynamicResistance) && trend === 'SELL' && currentPrice <= dynamicLevels.dynamicResistance) {
    adjustment += 2;
  }

  return {
    adjustment: clamp(adjustment, -15, 12),
    flags,
    nearestResistance,
    nearestSupport,
    resistanceDistancePct: Number.isFinite(resistanceDistancePct) ? round(resistanceDistancePct, 4) : null,
    supportDistancePct: Number.isFinite(supportDistancePct) ? round(supportDistancePct, 4) : null
  };
}

function analyzeSupportResistance(klines, trendData, volumeData) {
  if (!Array.isArray(klines) || klines.length < 30) {
    return {
      zones: [],
      zoneSummary: null,
      signalImpact: {
        adjustment: 0,
        flags: []
      }
    };
  }

  const closes = klines.map((candle) => toNumber(candle.close));
  const volumes = klines.map((candle) => toNumber(candle.volume));
  const avgVolume = volumes.reduce((sum, value) => sum + value, 0) / Math.max(1, volumes.length);

  const pivots = computePivotPoints(klines, 2);
  const points = [...pivots.highs, ...pivots.lows];
  const rawZones = buildZones(points, avgVolume, 0.35);
  const zones = detectRejections(klines, rawZones, 0.3);

  const currentPrice = toNumber(closes[closes.length - 1]);
  const recent = klines[klines.length - 1] || {};
  const dynamicLevels = deriveDynamicLevels(closes, toNumber(trendData?.ema9), toNumber(trendData?.ema21));

  const signalImpact = evaluateSupportResistanceForSignal({
    trend: trendData?.trend,
    currentPrice,
    trigger: trendData?.trigger,
    volumeData,
    zones,
    dynamicLevels,
    recentClose: toNumber(recent.close),
    recentHigh: toNumber(recent.high),
    recentLow: toNumber(recent.low)
  });

  const strongestZones = zones.slice(0, 6);

  return {
    zones: strongestZones,
    zoneSummary: {
      supports: strongestZones.filter((zone) => zone.side === 'support').length,
      resistances: strongestZones.filter((zone) => zone.side === 'resistance').length,
      dynamicLevels,
      pivotHighs: pivots.highs.length,
      pivotLows: pivots.lows.length
    },
    signalImpact
  };
}

module.exports = {
  computePivotPoints,
  analyzeSupportResistance,
  evaluateSupportResistanceForSignal
};
