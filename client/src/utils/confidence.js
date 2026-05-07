export const CONFIDENCE_BANDS = {
  high: {
    key: 'high',
    min: 80,
    text: 'High',
    muiColor: '#2e7d32',
    trackColor: 'rgba(46, 125, 50, 0.22)',
    tailwind: 'border-[#2a6b4e] bg-[#173427] text-[#64f2b3]'
  },
  medium: {
    key: 'medium',
    min: 60,
    text: 'Medium',
    muiColor: '#ed6c02',
    trackColor: 'rgba(237, 108, 2, 0.22)',
    tailwind: 'border-[#6b551f] bg-[#3a2d10] text-[#ffd56a]'
  },
  low: {
    key: 'low',
    min: 0,
    text: 'Low',
    muiColor: '#d32f2f',
    trackColor: 'rgba(211, 47, 47, 0.24)',
    tailwind: 'border-[#6b3040] bg-[#3b1b26] text-[#ff8fa1]'
  }
}

export const HIGH_DISAGREEMENT_THRESHOLD = 15

export const clampConfidence = (value, fallback = null) => {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

export const normalizeMachineConfidence = (value) => {
  const normalized = clampConfidence(value, null)
  if (normalized == null) {
    return {
      value: 0,
      missing: true
    }
  }

  return {
    value: normalized,
    missing: false
  }
}

export const normalizeAiConfidence = (value) => clampConfidence(value, null)

export const getConfidenceBand = (value) => {
  if (value >= CONFIDENCE_BANDS.high.min) return CONFIDENCE_BANDS.high
  if (value >= CONFIDENCE_BANDS.medium.min) return CONFIDENCE_BANDS.medium
  return CONFIDENCE_BANDS.low
}

export const getConfidenceDelta = (aiConfidence, machineConfidence) => {
  if (aiConfidence == null || machineConfidence == null) return null
  return aiConfidence - machineConfidence
}

export const formatDelta = (delta) => {
  if (delta == null) return 'N/A'
  if (delta === 0) return '0'
  return `${delta > 0 ? '+' : ''}${delta}`
}

export const isHighDisagreement = (delta) =>
  delta != null && Math.abs(delta) >= HIGH_DISAGREEMENT_THRESHOLD
