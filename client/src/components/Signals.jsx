import { useEffect, useMemo, useRef, useState } from 'react'
import { getMarketChart } from '../services/api'

const CHART_INTERVAL_OPTIONS = ['5m', '15m', '1h', '4h']
const CHART_LIMIT_BY_INTERVAL = {
  '5m': 96,
  '15m': 96,
  '1h': 120,
  '4h': 120
}
const DEFAULT_SIGNAL_VALIDITY_HOURS = 8
const DEFAULT_SIGNAL_VALIDITY_MS = DEFAULT_SIGNAL_VALIDITY_HOURS * 60 * 60 * 1000

const getExpiryTimestamp = (signal) => {
  if (!signal) return null
  if ((signal.status === 'ACTIVE' || signal.status === 'TAKEN') && signal.validUntil) {
    const ts = new Date(signal.validUntil).getTime()
    return Number.isFinite(ts) ? ts : null
  }
  if ((signal.status === 'ACTIVE' || signal.status === 'TAKEN') && signal.createdAt) {
    const createdTs = new Date(signal.createdAt).getTime()
    if (Number.isFinite(createdTs)) return createdTs + DEFAULT_SIGNAL_VALIDITY_MS
  }
  if (
    signal.expireAt
    && (
      signal.status === 'BLOCKED'
      || signal.result === 'TARGET_HIT'
      || signal.result === 'SL_HIT'
      || signal.result === 'EXPIRED'
    )
  ) {
    const ts = new Date(signal.expireAt).getTime()
    return Number.isFinite(ts) ? ts : null
  }
  return null
}

const formatCountdown = (diffMs) => {
  if (diffMs <= 0) return 'Expired'
  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatDateTime = (value) => {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'N/A'
  return parsed.toLocaleString()
}

const getSignalSortTimestamp = (signal) => {
  const value = signal?.closedAt || signal?.updatedAt || signal?.createdAt
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

const sortLatestClosedFirst = (signals) => (
  signals.slice().sort((a, b) => getSignalSortTimestamp(b) - getSignalSortTimestamp(a))
)

const getExecutionClass = (quality) => {
  if (quality === 'GOOD') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (quality === 'MODERATE') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (quality === 'RISKY') return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
}

const getTradeCallClass = (tradeCall) => {
  if (tradeCall === 'TAKE') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (tradeCall === 'WAIT') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (tradeCall === 'SKIP') return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
}

const getAiStatusClass = (status) => {
  if (status === 'SUCCESS') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (status === 'PENDING') return 'bg-[#19334a] text-[#8fc3ff] border border-[#2d5275]'
  if (status === 'FALLBACK') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (status === 'SKIPPED') return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
  return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
}

const compactAiReason = (value) => {
  const text = String(value || '').trim()
  if (!text || text === 'skipped') return ''
  return text
    .replace(/^rate_limited_cooldown_active_until_/, 'rate limited until ')
    .replace(/^invalid_machine_confidence_threshold_/, 'machine confidence below AI trigger ')
    .replace(/_/g, ' ')
}

const getDecisionClass = (decision) => {
  if (decision === 'TAKE') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (decision === 'WAIT') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (decision === 'SKIP') return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
}

const getAgreementStrengthFromScore = (score) => {
  if (!Number.isFinite(score)) return 'UNKNOWN'
  if (score >= 75) return 'STRONG'
  if (score >= 58) return 'ACCEPTABLE'
  if (score >= 45) return 'FRAGILE'
  return 'CONFLICT'
}

const getAgreementClass = (strength) => {
  if (strength === 'STRONG') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (strength === 'ACCEPTABLE') return 'bg-[#19334a] text-[#8fc3ff] border border-[#2d5275]'
  if (strength === 'FRAGILE') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (strength === 'CONFLICT') return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
}

const getRiskClass = (risk) => {
  if (risk === 'LOW') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (risk === 'MEDIUM') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (risk === 'HIGH' || risk === 'EXTREME') return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
}

const getTradeGradeClass = (grade) => {
  if (grade === 'A+' || grade === 'A') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (grade === 'B') return 'bg-[#19334a] text-[#8fc3ff] border border-[#2d5275]'
  if (grade === 'C') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (grade === 'D' || grade === 'REJECTED') return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
}

const formatRrRatio = (signal) => {
  const ratio = Number(signal?.rrAnalysis?.ratio ?? signal?.riskModel?.realizedRR)
  if (!Number.isFinite(ratio) || ratio <= 0) return 'N/A'
  return `1:${ratio.toFixed(2)}`
}

const getTradeMovePercents = (signal) => {
  const entryPrice = Number(signal?.entryPrice)
  const target = Number(signal?.target)
  const stopLoss = Number(signal?.stopLoss)

  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(target) || !Number.isFinite(stopLoss)) {
    return { profitPercent: '0.00', lossPercent: '0.00' }
  }

  if (signal?.type === 'SELL') {
    return {
      profitPercent: ((entryPrice - target) / entryPrice * 100).toFixed(2),
      lossPercent: ((stopLoss - entryPrice) / entryPrice * 100).toFixed(2)
    }
  }

  return {
    profitPercent: ((target - entryPrice) / entryPrice * 100).toFixed(2),
    lossPercent: ((entryPrice - stopLoss) / entryPrice * 100).toFixed(2)
  }
}

const getSignalQualityView = (qualityData, qualityApiFailed) => {
  if (qualityApiFailed || !qualityData || qualityData.unavailable) {
    return {
      spread: 'N/A',
      pressure: 'N/A',
      executionQuality: 'N/A',
      slippageRisk: 'N/A'
    }
  }

  const spread = typeof qualityData.spreadPct === 'number'
    ? `${qualityData.spreadPct.toFixed(4)}%`
    : 'N/A'

  const pressure = (typeof qualityData.imbalanceBuyPct === 'number' && typeof qualityData.imbalanceSellPct === 'number')
    ? `Buy ${qualityData.imbalanceBuyPct.toFixed(1)}% / Sell ${qualityData.imbalanceSellPct.toFixed(1)}%`
    : 'N/A'

  return {
    spread,
    pressure,
    executionQuality: qualityData.executionQuality || 'N/A',
    slippageRisk: qualityData.slippageRisk || 'N/A'
  }
}

const TrendChart = ({ points, interval, loading, error, onIntervalChange }) => {
  const width = 560
  const height = 170
  const padding = 14

  const chartData = useMemo(() => {
    if (!Array.isArray(points) || points.length < 2) return null

    const closes = points.map((p) => Number(p.close)).filter(Number.isFinite)
    if (closes.length < 2) return null

    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const range = Math.max(max - min, 1e-9)

    const line = closes
      .map((price, index) => {
        const x = padding + (index / (closes.length - 1)) * (width - padding * 2)
        const y = padding + ((max - price) / range) * (height - padding * 2)
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')

    const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`
    const changePct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100

    return {
      min,
      max,
      line,
      area,
      changePct,
      last: closes[closes.length - 1]
    }
  }, [points])

  const isUp = (chartData?.changePct || 0) >= 0

  return (
    <div className="rounded-xl border border-[#2b3c59] bg-[#101b2e] p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.12em] text-[#8ea2c4]">Price Trend</p>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#16233a] border border-[#2a3a55]">
            {CHART_INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onIntervalChange(opt)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                  interval === opt
                    ? 'bg-[#f0b90b] text-[#111b1f]'
                    : 'text-[#9ab0d3] hover:text-white hover:bg-[#22334f]'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        {chartData && (
          <p className={`text-sm font-semibold ${isUp ? 'text-[#64f2b3]' : 'text-[#ff8fa1]'}`}>
            {isUp ? '+' : ''}{chartData.changePct.toFixed(2)}%
          </p>
        )}
      </div>

      {loading && (
        <div className="h-[170px] rounded-xl bg-[#17243a] border border-[#2b3c59] animate-pulse"></div>
      )}

      {!loading && error && (
        <div className="h-[170px] rounded-xl bg-[#17243a] border border-[#2b3c59] flex items-center justify-center text-sm text-[#9bb0d3]">
          Chart unavailable
        </div>
      )}

      {!loading && !error && !chartData && (
        <div className="h-[170px] rounded-xl bg-[#17243a] border border-[#2b3c59] flex items-center justify-center text-sm text-[#9bb0d3]">
          Not enough chart data
        </div>
      )}

      {!loading && !error && chartData && (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[170px]">
            <defs>
              <linearGradient id="trendAreaSignal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isUp ? '#19c37d' : '#f6465d'} stopOpacity="0.35" />
                <stop offset="100%" stopColor={isUp ? '#19c37d' : '#f6465d'} stopOpacity="0.03" />
              </linearGradient>
            </defs>
            <path d={`M ${chartData.area}`} fill="url(#trendAreaSignal)" />
            <polyline
              points={chartData.line}
              fill="none"
              stroke={isUp ? '#64f2b3' : '#ff8fa1'}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#8ea2c4]">
            <span>Low: ${chartData.min.toFixed(4)}</span>
            <span>High: ${chartData.max.toFixed(4)}</span>
            <span>Now: ${chartData.last.toFixed(4)}</span>
          </div>
        </>
      )}
    </div>
  )
}

const SignalCard = ({ signal, isExpanded, onToggle, actionLoading, onTake, qualityData, qualityApiFailed, canTrade }) => {
  const conf = signal.confidence ?? 0
  const isActive = signal.status === 'ACTIVE'
  const isTaken = signal.status === 'TAKEN'
  const isBlocked = signal.status === 'BLOCKED'
  const isTargetHit = signal.result === 'TARGET_HIT'
  const [timeLeft, setTimeLeft] = useState('')
  const [chartInterval, setChartInterval] = useState('15m')
  const [chartDataByInterval, setChartDataByInterval] = useState({})
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const qualityView = getSignalQualityView(qualityData, qualityApiFailed)
  const expiryTimestamp = getExpiryTimestamp(signal)
  const hasActiveValidity = signal.status === 'ACTIVE' || signal.status === 'TAKEN'
  const hasCleanupTtl = Boolean(
    signal.expireAt
    && (
      signal.status === 'BLOCKED'
      || signal.result === 'TARGET_HIT'
      || signal.result === 'SL_HIT'
      || signal.result === 'EXPIRED'
    )
  )
  const validityLabel = hasActiveValidity ? 'Valid for' : hasCleanupTtl ? 'Cleanup in' : ''

  useEffect(() => {
    if (!expiryTimestamp) return

    const updateTimer = () => {
      const now = Date.now()
      const diff = expiryTimestamp - now
      setTimeLeft(formatCountdown(diff))
    }

    updateTimer()
    const interval = setInterval(updateTimer, 30000)
    return () => clearInterval(interval)
  }, [expiryTimestamp])

  useEffect(() => {
    if (!isExpanded || !signal?.coin) return
    if (chartDataByInterval[chartInterval]) return

    let active = true
    const bootTimer = setTimeout(() => {
      if (!active) return
      setChartLoading(true)
      setChartError('')
    }, 0)

    getMarketChart(signal.coin, chartInterval, CHART_LIMIT_BY_INTERVAL[chartInterval] || 96)
      .then((res) => {
        if (!active) return
        const points = Array.isArray(res?.data?.points) ? res.data.points : []
        setChartDataByInterval((prev) => ({
          ...prev,
          [chartInterval]: points
        }))
      })
      .catch((err) => {
        if (!active) return
        setChartError(err?.message || 'Chart fetch failed')
      })
      .finally(() => {
        if (!active) return
        setChartLoading(false)
      })

    return () => {
      active = false
      clearTimeout(bootTimer)
    }
  }, [isExpanded, signal?.coin, chartInterval, chartDataByInterval])

  const handleChartIntervalChange = (nextInterval) => {
    setChartError('')
    setChartInterval(nextInterval)
  }

  const getConfLabel = (c) => {
    if (c >= 80) return 'STRONG'
    if (c >= 65) return 'NORMAL'
    if (c >= 50) return 'WEAK'
    return 'LOW'
  }

  const { profitPercent, lossPercent } = getTradeMovePercents(signal)
  const reason = signal.reason || {}
  const chartPoints = chartDataByInterval[chartInterval] || []
  const nvidiaConfidenceValue = Number(signal.nvidiaConfidence)
  const hasNvidiaConfidence = Number.isFinite(nvidiaConfidenceValue)
  const hasGroqAssessment = Boolean(signal.groqTradeCall || signal.groqInsight)
  const hasNvidiaAssessment = Boolean(signal.nvidiaTradeCall || signal.nvidiaInsight || hasNvidiaConfidence)
  const groqStatus = String(signal.aiStatus || signal.grokValidation?.status || 'UNKNOWN').toUpperCase()
  const nvidiaStatus = String(signal.nvidiaStatus || signal.nvidiaValidation?.status || 'UNKNOWN').toUpperCase()
  const groqAttempts = Number(signal.aiAttempts ?? signal.grokValidation?.attempts)
  const nvidiaAttempts = Number(signal.nvidiaAttempts ?? signal.nvidiaValidation?.attempts)
  const groqReason = compactAiReason(signal.aiError || signal.grokValidation?.error || signal.grokValidation?.minor_risks?.[0])
  const nvidiaReason = compactAiReason(signal.nvidiaError || signal.nvidiaValidation?.error || signal.nvidiaValidation?.minor_risks?.[0])
  const triCoreConfidence = Number.isFinite(Number(signal.aiConfidence))
    ? Number(signal.aiConfidence)
    : Number(signal.confidence || 0)
  const finalDecision = String(signal.finalTradeDecision || '').toUpperCase() || 'WAIT'
  const tradeGrade = signal.tradeQualityGrade || signal.executionIntelligence?.tradeQualityGrade || 'N/A'
  const agreementScore = Number(signal.aiAgreementScore)
  const agreementStrength = signal.agreementStrength || getAgreementStrengthFromScore(agreementScore)
  const rrRatio = formatRrRatio(signal)
  const riskGrade = signal.riskGrade || signal.executionIntelligence?.riskGrade || 'UNKNOWN'
  const tradeDecisionReason = signal.tradeDecisionReason || signal.executionIntelligence?.tradeDecisionReason || ''
  const persistGateReasons = Array.isArray(signal.persistGateReasons) ? signal.persistGateReasons : []
  const skipWarningMessage = tradeDecisionReason
    ? `System recommends SKIP due to risk. ${tradeDecisionReason}`
    : 'System recommends SKIP due to risk.'

  return (
    <div
      className={`
        bg-[#111b2d]/95 border rounded-2xl overflow-hidden transition-all duration-300
        ${isExpanded ? 'border-[#f0b90b]/50 shadow-[0_20px_36px_rgba(5,8,15,0.52)]' : 'border-[#2a3a55] hover:border-[#3b4f73]'}
        ${conf < 50 ? 'opacity-70' : ''}
        ${isTaken ? 'ring-2 ring-[#19c37d]/40' : ''}
        ${isTargetHit ? 'ring-2 ring-[#19c37d]/30' : ''}
      `}
    >
      <div className="p-5 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div
              className={`
                w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold
                ${signal.type === 'BUY' ? 'bg-[#173427] text-[#64f2b3]' : 'bg-[#3b1b26] text-[#ff8fa1]'}
              `}
            >
              {signal.type}
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">{signal.coin}</h3>
              <p className="text-sm text-[#90a4c7] mt-1">Decision-first signal card</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {(hasActiveValidity || hasCleanupTtl) && timeLeft && (
              <span className={`px-2.5 py-1 text-xs font-semibold rounded-lg border ${timeLeft === 'Expired' ? 'bg-[#3b1b26] text-[#ff8fa1] border-[#6b3040]' : 'bg-[#3a2d10] text-[#ffd56a] border-[#6b551f]'}`}>
                {validityLabel} {timeLeft}
              </span>
            )}

            <span className={`px-3 py-1 text-xs font-bold rounded-lg ${getDecisionClass(finalDecision)}`}>
              {finalDecision}
            </span>
          </div>
        </div>

        {!isExpanded && (
          <div className="mt-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="bg-[#16233a] border border-[#2b3f5d] rounded-lg px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8ea2c4]">Entry</p>
                <p className="text-sm font-semibold text-white">${signal.entryPrice}</p>
              </div>
              <div className="bg-[#16233a] border border-[#2b3f5d] rounded-lg px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8ea2c4]">Target</p>
                <p className="text-sm font-semibold text-[#64f2b3]">${signal.target}</p>
              </div>
              <div className="bg-[#16233a] border border-[#2b3f5d] rounded-lg px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8ea2c4]">Stoploss</p>
                <p className="text-sm font-semibold text-[#ff8fa1]">${signal.stopLoss}</p>
              </div>
              <div className="bg-[#16233a] border border-[#2b3f5d] rounded-lg px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8ea2c4]">Confidence</p>
                <p className="text-sm font-semibold text-white">{Math.round(triCoreConfidence)}%</p>
              </div>
              <div className="bg-[#16233a] border border-[#2b3f5d] rounded-lg px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8ea2c4]">RR</p>
                <p className="text-sm font-semibold text-white">{rrRatio}</p>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="bg-[#16233a] border border-[#2b3f5d] rounded-lg px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8ea2c4]">Risk</p>
                <span className={`inline-flex mt-1 px-2 py-0.5 rounded text-xs font-semibold ${getRiskClass(riskGrade)}`}>
                  {riskGrade}
                </span>
              </div>
              <div className="bg-[#16233a] border border-[#2b3f5d] rounded-lg px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8ea2c4]">Valid Time</p>
                <p className={`text-sm font-semibold ${timeLeft === 'Expired' ? 'text-[#ff8fa1]' : 'text-white'}`}>
                  {timeLeft || 'N/A'}
                </p>
              </div>
            </div>

            {finalDecision === 'SKIP' && (
              <p className="mt-3 text-xs text-[#ffb3c2] bg-[#2a1620] border border-[#6b3040] rounded-lg px-3 py-2">
                {skipWarningMessage}
              </p>
            )}
            {isBlocked && (
              <div className="mt-3 text-xs text-[#ffb3c2] bg-[#2a1620] border border-[#6b3040] rounded-lg px-3 py-2">
                <p className="font-semibold">Blocked by final quality gate.</p>
                {persistGateReasons.length > 0 && (
                  <p className="mt-1 break-words">Reasons: {persistGateReasons.join(', ')}</p>
                )}
              </div>
            )}

            {isActive && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!canTrade || actionLoading === signal._id) return
                    onTake(signal._id)
                  }}
                  disabled={!canTrade || actionLoading === signal._id}
                  className="
                    flex-1 px-4 py-2.5 text-sm font-bold bg-[#19c37d] text-white rounded-xl hover:bg-[#13a96b]
                    disabled:opacity-50 disabled:cursor-not-allowed transition-all
                  "
                >
                  {actionLoading === signal._id ? 'Processing...' : 'Take Trade'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle()
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl bg-[#1b2b45] text-[#c8d8f0] border border-[#35507a] hover:bg-[#223555]"
                >
                  View Analysis
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-[#2a3a55] bg-[#0d1728] p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-[#8ea2c4] uppercase tracking-wider font-semibold">Full Analysis</p>
            <button
              type="button"
              onClick={onToggle}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1b2b45] text-[#c8d8f0] border border-[#35507a] hover:bg-[#223555]"
            >
              Hide Analysis
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div className="bg-[#111b2d] p-4 rounded-xl border border-[#2a3a55]">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider">Entry</p>
              <p className="text-2xl font-bold text-white">${signal.entryPrice}</p>
            </div>
            <div className="bg-[#111b2d] p-4 rounded-xl border border-[#2a3a55]">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider">Target</p>
              <p className="text-2xl font-bold text-[#64f2b3]">${signal.target}</p>
              <p className="text-sm text-[#64f2b3]">+{profitPercent}% profit</p>
            </div>
            <div className="bg-[#111b2d] p-4 rounded-xl border border-[#2a3a55]">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider">Stop Loss</p>
              <p className="text-2xl font-bold text-[#ff8fa1]">${signal.stopLoss}</p>
              <p className="text-sm text-[#ff8fa1]">{lossPercent}% loss</p>
            </div>
          </div>

          <div className="mb-6 bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className={`px-3 py-1 text-xs font-bold rounded-lg ${getDecisionClass(finalDecision)}`}>
                Final Decision: {finalDecision}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getTradeGradeClass(tradeGrade)}`}>
                Trade Grade: {tradeGrade}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getAgreementClass(agreementStrength)}`}>
                AI Agreement: {agreementStrength}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getRiskClass(riskGrade)}`}>
                Risk: {riskGrade}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-[#18253a] rounded-lg p-2 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">TriCore Confidence</p>
                <p className="font-semibold text-white mt-1">{Math.round(triCoreConfidence)}%</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-2 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Machine Confidence</p>
                <p className="font-semibold text-white mt-1">{Math.round(conf)}%</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-2 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">RR Ratio</p>
                <p className="font-semibold text-white mt-1">{rrRatio}</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-2 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Signal Quality</p>
                <p className="font-semibold text-white mt-1">{signal.signalQuality || getConfLabel(conf)}</p>
              </div>
            </div>
            {tradeDecisionReason && (
              <p className="mt-3 text-xs text-[#8ea2c4]">
                Decision reason: <span className="text-[#dbe7fb]">{tradeDecisionReason}</span>
              </p>
            )}
          </div>

          <div className="mb-6 bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4">
            <p className="text-xs text-[#8ea2c4] uppercase tracking-wider mb-3 font-semibold">Execution Quality</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-2 bg-[#18253a] rounded-lg">
                <p className="text-xs text-[#8ea2c4]">Spread</p>
                <p className="text-sm font-semibold text-white">{qualityView.spread}</p>
              </div>
              <div className="p-2 bg-[#18253a] rounded-lg">
                <p className="text-xs text-[#8ea2c4]">Orderbook Pressure</p>
                <p className="text-sm font-semibold text-white">{qualityView.pressure}</p>
              </div>
              <div className="p-2 bg-[#18253a] rounded-lg">
                <p className="text-xs text-[#8ea2c4]">Execution</p>
                <span className={`inline-flex mt-1 px-2 py-0.5 rounded text-xs font-semibold ${getExecutionClass(qualityView.executionQuality)}`}>
                  {qualityView.executionQuality}
                </span>
              </div>
              <div className="p-2 bg-[#18253a] rounded-lg">
                <p className="text-xs text-[#8ea2c4]">Slippage Risk</p>
                <p className="text-sm font-semibold text-white">{qualityView.slippageRisk}</p>
              </div>
            </div>
          </div>

          <div className="mb-6 bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4">
            <p className="text-xs text-[#8ea2c4] uppercase tracking-wider mb-3 font-semibold">Execution Intelligence</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Structure-aware Stoploss Logic</p>
                <p className="text-[#dbe7fb] mt-1">{signal.structureStopReason || 'N/A'}</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Target Logic</p>
                <p className="text-[#dbe7fb] mt-1">{signal.targetLogicReason || 'N/A'}</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Execution Realism Score</p>
                <p className="font-semibold text-white mt-1">
                  {Number.isFinite(Number(signal.executionRealismScore)) ? `${Math.round(Number(signal.executionRealismScore))}%` : 'N/A'}
                </p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Survivability Score</p>
                <p className="font-semibold text-white mt-1">
                  {Number.isFinite(Number(signal.survivabilityScore)) ? `${Math.round(Number(signal.survivabilityScore))}%` : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6 bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4">
            <p className="text-xs text-[#8ea2c4] uppercase tracking-wider mb-3 font-semibold">Market Structure and Orderflow</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Structure</p>
                <p className="text-[#dbe7fb] mt-1">{signal.marketStructure?.trendBias || signal.marketStructureSignal?.reason || 'N/A'}</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Regime</p>
                <p className="text-[#dbe7fb] mt-1">{signal.regimeContext?.regime || signal.regime || 'N/A'}</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">CVD</p>
                <p className="text-[#dbe7fb] mt-1">{signal.cvdContext?.cvdDivergence || signal.realtimeContext?.cvdDivergence || 'N/A'}</p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Liquidation</p>
                <p className="text-[#dbe7fb] mt-1">
                  {Array.isArray(signal.liquidationContext?.flags) && signal.liquidationContext.flags.length > 0
                    ? signal.liquidationContext.flags.join(', ')
                    : 'N/A'}
                </p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">Depth</p>
                <p className="text-[#dbe7fb] mt-1">
                  {Array.isArray(signal.depthContext?.flags) && signal.depthContext.flags.length > 0
                    ? signal.depthContext.flags.join(', ')
                    : 'N/A'}
                </p>
              </div>
              <div className="bg-[#18253a] rounded-lg p-3 border border-[#2a3a55]">
                <p className="text-[#8ea2c4]">RR Analysis</p>
                <p className="text-[#dbe7fb] mt-1">
                  {signal.executionIntelligence?.rrAnalysis?.commentary
                    || signal.rrAnalysis?.commentary
                    || `RR ${rrRatio}`}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <TrendChart
              points={chartPoints}
              interval={chartInterval}
              loading={chartLoading}
              error={chartError}
              onIntervalChange={handleChartIntervalChange}
            />
          </div>

          <div className="mb-4 text-sm text-[#9ab0d3]">
            <p>Trend: <span className="font-semibold text-white">{reason.trend || 'N/A'}</span></p>
            <p>RSI: <span className="font-semibold text-white">{reason.rsi || 'N/A'}</span></p>
            <p>Volume: <span className="font-semibold text-white">{reason.volume || 'N/A'}</span></p>
            <p>News: <span className="font-semibold text-white">{reason.sentiment || 'N/A'}</span></p>
          </div>

          {(hasGroqAssessment || hasNvidiaAssessment) && (
            <p className="mb-2 text-xs text-[#8ea2c4] uppercase tracking-wider font-semibold">Risk Assessment</p>
          )}

          {hasGroqAssessment && (
            <div className="mb-4 p-4 bg-[#0f1e35] border border-[#2a1e5f] rounded-xl">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider mb-2 font-semibold flex items-center gap-2">
                <span className="text-[#a78bfa]">AI</span> Grok Validator
              </p>
              <div className="mt-2 mb-2">
                <span className={`px-2 py-0.5 text-xs font-semibold rounded ${getTradeCallClass(signal.groqTradeCall)}`}>
                  {signal.groqTradeCall || 'N/A'}
                </span>
              </div>
              <p className="text-sm text-[#c8d8f0] leading-relaxed">{signal.groqInsight || 'No comment'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 font-semibold rounded ${getAiStatusClass(groqStatus)}`}>
                  {groqStatus}
                </span>
                {Number.isFinite(groqAttempts) && (
                  <span className="text-[#8ea2c4]">Attempts: {groqAttempts}</span>
                )}
                {groqReason && (
                  <span className="text-[#ffb3c2] break-words">Reason: {groqReason}</span>
                )}
              </div>
            </div>
          )}

          {hasNvidiaAssessment && (
            <div className="mb-4 p-4 bg-[#0f1f1f] border border-[#1f5f56] rounded-xl">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider mb-2 font-semibold flex items-center gap-2">
                <span className="text-[#58d7c4]">AI</span> NVIDIA Validator
              </p>
              <div className="mt-2 mb-2">
                <span className={`px-2 py-0.5 text-xs font-semibold rounded ${getTradeCallClass(signal.nvidiaTradeCall)}`}>
                  {signal.nvidiaTradeCall || 'N/A'}
                </span>
              </div>
              <p className="text-sm text-[#c8f0eb] leading-relaxed">{signal.nvidiaInsight || 'No comment'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 font-semibold rounded ${getAiStatusClass(nvidiaStatus)}`}>
                  {nvidiaStatus}
                </span>
                {Number.isFinite(nvidiaAttempts) && (
                  <span className="text-[#8ec7bf]">Attempts: {nvidiaAttempts}</span>
                )}
                {nvidiaReason && (
                  <span className="text-[#ffb3c2] break-words">Reason: {nvidiaReason}</span>
                )}
              </div>
              <p className="mt-2 text-xs text-[#8ec7bf]">
                Confidence: <span className="font-semibold text-[#d4fff8]">{hasNvidiaConfidence ? `${Math.round(nvidiaConfidenceValue)}%` : 'N/A'}</span>
              </p>
            </div>
          )}

          {(signal.createdAt || expiryTimestamp) && (
            <div className="mb-4 flex items-center gap-4 text-sm text-[#8ea2c4]">
              {signal.createdAt && <span>Generated: {new Date(signal.createdAt).toLocaleString()}</span>}
              {(hasActiveValidity && signal.validUntil) && (
                <span>Valid till: {formatDateTime(signal.validUntil)}</span>
              )}
              {(hasCleanupTtl && signal.expireAt) && (
                <span>Auto cleanup: {formatDateTime(signal.expireAt)}</span>
              )}
              {(hasActiveValidity || hasCleanupTtl) && timeLeft && (
                <span className={timeLeft === 'Expired' ? 'text-[#f6465d] font-semibold' : 'text-[#ffd56a] font-semibold'}>
                  {timeLeft === 'Expired' ? 'Expired' : `${validityLabel} ${timeLeft}`}
                </span>
              )}
            </div>
          )}

          {isActive ? (
            <div className="flex gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canTrade || actionLoading === signal._id) return
                  onTake(signal._id)
                }}
                disabled={!canTrade || actionLoading === signal._id}
                className="
                  flex-1 px-6 py-3 text-sm font-bold bg-[#19c37d] text-white
                  rounded-xl hover:bg-[#13a96b]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all transform hover:scale-[1.02] active:scale-[0.98]
                "
              >
                {actionLoading === signal._id ? 'Processing...' : 'Take Trade'}
              </button>
            </div>
          ) : (
            <div className="p-4 bg-[#1a2740] rounded-xl border border-[#2d3f5d]">
              <p className="text-sm font-medium text-[#d1dcf0]">
                {isBlocked && 'Blocked Signal: this setup was saved for review but rejected by persist gate.'}
                {signal.result === 'TARGET_HIT' && 'Target Hit: this signal reached its profit target.'}
                {signal.result === 'SL_HIT' && 'Stop Loss Hit: this signal hit the stop loss.'}
                {signal.result === 'EXPIRED' && 'Signal Expired: validity window ended before target or stop loss.'}
                {signal.result === 'PENDING' && !isBlocked && 'Signal closed without target or stop loss hit.'}
              </p>
              {isBlocked && persistGateReasons.length > 0 && (
                <p className="text-xs text-[#ffb3c2] mt-2 break-words">
                  Gate reasons: {persistGateReasons.join(', ')}
                </p>
              )}
              {signal.closedAt && (
                <p className="text-xs text-[#9cb0d2] mt-1">
                  Closed: {new Date(signal.closedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const Signals = ({ signals, loading, actionLoading, onTake, qualityBySymbol = {}, qualityApiFailed = false, canTrade = true }) => {
  const [expandedId, setExpandedId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [showPinnedSectionNav, setShowPinnedSectionNav] = useState(false)
  const vaultTopRef = useRef(null)
  const sectionTabsAnchorRef = useRef(null)
  const generatedRef = useRef(null)
  const blockedRef = useRef(null)
  const targetHitRef = useRef(null)
  const slHitRef = useRef(null)
  const expiredRef = useRef(null)

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 420)
      const anchorTop = sectionTabsAnchorRef.current?.getBoundingClientRect?.().top
      setShowPinnedSectionNav(Number.isFinite(anchorTop) ? anchorTop <= 96 : false)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f0b90b]"></div>
      </div>
    )
  }

  if (signals.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-20 h-20 bg-[#111b2d] border border-[#2a3a55] rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl text-[#f0b90b] font-bold">SIG</span>
        </div>
        <p className="text-[#a4b6d6] text-lg">No signals available</p>
        <p className="text-[#6f83a6] text-sm mt-2">Signals will appear here when the engine generates them</p>
      </div>
    )
  }

  const searchTermTrimmed = searchTerm.trim()
  const normalizedSearch = searchTermTrimmed.toUpperCase()
  const hasActiveSearch = normalizedSearch.length > 0
  const filteredSignals = hasActiveSearch
    ? signals.filter((signal) => String(signal?.coin || '').toUpperCase().includes(normalizedSearch))
    : signals
  const hasMatchingSignals = filteredSignals.length > 0

  const generatedSignals = filteredSignals.filter((s) => s.status === 'ACTIVE' || s.status === 'TAKEN')
  const blockedSignals = filteredSignals.filter((s) => s.status === 'BLOCKED')
  const targetHitSignals = sortLatestClosedFirst(filteredSignals.filter((s) => s.result === 'TARGET_HIT'))
  const slHitSignals = sortLatestClosedFirst(filteredSignals.filter((s) => s.result === 'SL_HIT'))
  const expiredSignals = filteredSignals.filter((s) => s.result === 'EXPIRED')

  const renderSignalGroup = (groupSignals) => (
    <div className="space-y-3">
      {groupSignals.map((signal) => (
        <SignalCard
          key={signal._id}
          signal={signal}
          isExpanded={expandedId === signal._id}
          onToggle={() => setExpandedId(expandedId === signal._id ? null : signal._id)}
          actionLoading={actionLoading}
          onTake={onTake}
          qualityData={qualityBySymbol?.[signal.coin]}
          qualityApiFailed={qualityApiFailed}
          canTrade={canTrade}
        />
      ))}
    </div>
  )

  const jumpToSection = (sectionRef) => {
    if (!sectionRef?.current) return
    sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const scrollToVaultTop = () => {
    if (!vaultTopRef.current) return
    vaultTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const renderSectionNavButtons = () => (
    <>
      <button
        type="button"
        onClick={() => jumpToSection(generatedRef)}
        disabled={generatedSignals.length === 0}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#162a45] text-[#8fc3ff] border border-[#34527c] hover:bg-[#1b3354] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Generated ({generatedSignals.length})
      </button>
      <button
        type="button"
        onClick={() => jumpToSection(blockedRef)}
        disabled={blockedSignals.length === 0}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2a1620] text-[#ffb3c2] border border-[#6b3040] hover:bg-[#321b27] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Blocked ({blockedSignals.length})
      </button>
      <button
        type="button"
        onClick={() => jumpToSection(targetHitRef)}
        disabled={targetHitSignals.length === 0}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#173427] text-[#64f2b3] border border-[#2a6b4e] hover:bg-[#1c4231] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Target Hit ({targetHitSignals.length})
      </button>
      <button
        type="button"
        onClick={() => jumpToSection(slHitRef)}
        disabled={slHitSignals.length === 0}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#332238] text-[#ffb0c2] border border-[#6b3f4f] hover:bg-[#412b46] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        SL Hit ({slHitSignals.length})
      </button>
      <button
        type="button"
        onClick={() => jumpToSection(expiredRef)}
        disabled={expiredSignals.length === 0}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#243247] text-[#bfd0ea] border border-[#3f5575] hover:bg-[#2b3c54] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Expired ({expiredSignals.length})
      </button>
    </>
  )

  return (
    <div>
      <div ref={vaultTopRef} className="mb-6 scroll-mt-28">
        <h2 className="text-2xl font-bold text-white">Signal Vault</h2>
        <p className="text-[#8ea2c4] text-sm mt-1">
          {generatedSignals.length} generated | {blockedSignals.length} blocked | {targetHitSignals.length} target hit | {slHitSignals.length} SL hit | {expiredSignals.length} expired
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[#2d476e] bg-[#101f35]/90 px-3 py-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-[#8ea2c4]">Search</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Coin name (e.g. BTC)"
              className="w-44 sm:w-56 bg-transparent text-sm text-white placeholder:text-[#7088af] outline-none"
            />
            {hasActiveSearch && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="rounded-md border border-[#39557f] bg-[#162a45] px-2 py-0.5 text-xs font-semibold text-[#c7d8f2] hover:bg-[#1f3554]"
              >
                Clear
              </button>
            )}
          </div>
          {hasActiveSearch && (
            <p className="text-xs text-[#9ab0d3]">
              {filteredSignals.length} match{filteredSignals.length === 1 ? '' : 'es'} for "{searchTermTrimmed}"
            </p>
          )}
        </div>
        {qualityApiFailed && (
          <p className="text-xs text-[#ffd56a] mt-2">
            Market quality feed unavailable. Showing fallback labels.
          </p>
        )}
      </div>

      <div
        ref={sectionTabsAnchorRef}
        className="mb-5 rounded-xl border border-[#294163] bg-[linear-gradient(180deg,rgba(9,20,36,0.95),rgba(10,21,39,0.86))] px-2 py-2"
      >
        <div className={`flex flex-wrap gap-2 ${showPinnedSectionNav ? 'invisible' : ''}`}>
          {renderSectionNavButtons()}
        </div>
      </div>

      <div className="space-y-4">
        {!hasMatchingSignals && (
          <div className="rounded-xl border border-[#2a3a55] bg-[#111b2d] p-6 text-center">
            <p className="text-[#d4e0f5] font-semibold">No matching coins found</p>
            <p className="text-sm text-[#8ea2c4] mt-1">Try another symbol like BTC, ETH, SOL, or ADA.</p>
          </div>
        )}

        {generatedSignals.length > 0 && (
          <div ref={generatedRef} className="scroll-mt-40">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#f0b90b] rounded-full"></span>
              Generated Signals ({generatedSignals.length})
            </h3>
            {renderSignalGroup(generatedSignals)}
          </div>
        )}

        {blockedSignals.length > 0 && (
          <div ref={blockedRef} className="mt-8 scroll-mt-40">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#ff8fa1] rounded-full"></span>
              Blocked / Rejected ({blockedSignals.length})
            </h3>
            {renderSignalGroup(blockedSignals)}
          </div>
        )}

        {targetHitSignals.length > 0 && (
          <div ref={targetHitRef} className="mt-8 scroll-mt-40">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#19c37d] rounded-full"></span>
              Target Hit Signals ({targetHitSignals.length})
            </h3>
            {renderSignalGroup(targetHitSignals)}
          </div>
        )}

        {slHitSignals.length > 0 && (
          <div ref={slHitRef} className="mt-8 scroll-mt-40">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#ff8fa1] rounded-full"></span>
              SL Hit Signals ({slHitSignals.length})
            </h3>
            {renderSignalGroup(slHitSignals)}
          </div>
        )}

        {expiredSignals.length > 0 && (
          <div ref={expiredRef} className="mt-8 scroll-mt-40">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#a8b8d7] rounded-full"></span>
              Expired Signals ({expiredSignals.length})
            </h3>
            {renderSignalGroup(expiredSignals)}
          </div>
        )}
      </div>

      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToVaultTop}
          className="fixed bottom-6 right-6 z-30 rounded-full border border-[#46658e] bg-[#142742]/95 px-4 py-2 text-xs font-bold tracking-wide text-[#d9e7ff] shadow-[0_10px_26px_rgba(6,12,22,0.48)] transition hover:bg-[#1a3356]"
        >
          Back To Top
        </button>
      )}

      {showPinnedSectionNav && (
        <div className="fixed left-0 right-0 top-2 sm:top-3 z-40 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto rounded-xl border border-[#294163] bg-[linear-gradient(180deg,rgba(9,20,36,0.95),rgba(10,21,39,0.88))] px-2 py-2 backdrop-blur">
            <div className="flex flex-wrap gap-2">
              {renderSectionNavButtons()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


export default Signals

