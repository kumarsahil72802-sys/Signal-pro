import { useEffect, useMemo, useRef, useState } from 'react'
import { getMarketChart } from '../services/api'
import ConfidenceComparison from './confidence/ConfidenceComparison'

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
  if (signal.expireAt && (signal.result === 'TARGET_HIT' || signal.result === 'SL_HIT' || signal.result === 'EXPIRED')) {
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

const getExecutionClass = (quality) => {
  if (quality === 'GOOD') return 'bg-[#173427] text-[#64f2b3] border border-[#2a6b4e]'
  if (quality === 'MODERATE') return 'bg-[#3a2d10] text-[#ffd56a] border border-[#6b551f]'
  if (quality === 'RISKY') return 'bg-[#3b1b26] text-[#ff8fa1] border border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border border-[#30435f]'
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

const SignalCard = ({ signal, isExpanded, onToggle, actionLoading, onTake, qualityData, qualityApiFailed, canTrade, onRequireAuth }) => {
  const conf = signal.confidence ?? 0
  const isActive = signal.status === 'ACTIVE'
  const isTaken = signal.status === 'TAKEN'
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
    signal.expireAt && (signal.result === 'TARGET_HIT' || signal.result === 'SL_HIT' || signal.result === 'EXPIRED')
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

  const profitPercent = ((signal.target - signal.entryPrice) / signal.entryPrice * 100).toFixed(2)
  const lossPercent = ((signal.stopLoss - signal.entryPrice) / signal.entryPrice * 100).toFixed(2)
  const reason = signal.reason || {}
  const chartPoints = chartDataByInterval[chartInterval] || []
  const nvidiaConfidenceValue = Number(signal.nvidiaConfidence)
  const hasNvidiaConfidence = Number.isFinite(nvidiaConfidenceValue)

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
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`
                    px-2 py-0.5 text-xs font-bold rounded-full
                    ${signal.type === 'BUY' ? 'bg-[#173427] text-[#64f2b3]' : 'bg-[#3b1b26] text-[#ff8fa1]'}
                  `}
                >
                  {signal.type}
                </span>
                <span className="text-sm text-[#90a4c7]">
                  Entry: <span className="font-semibold text-[#e5edfa]">${signal.entryPrice}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {(hasActiveValidity || hasCleanupTtl) && timeLeft && (
              <span className={`px-2.5 py-1 text-xs font-semibold rounded-lg border ${timeLeft === 'Expired' ? 'bg-[#3b1b26] text-[#ff8fa1] border-[#6b3040]' : 'bg-[#3a2d10] text-[#ffd56a] border-[#6b551f]'}`}>
                {validityLabel} {timeLeft}
              </span>
            )}

            <span
              className={`
                px-3 py-1 text-xs font-medium rounded-full
                ${signal.status === 'ACTIVE' ? 'bg-[#172b49] text-[#85baff]' : ''}
                ${signal.status === 'TAKEN' ? 'bg-[#173427] text-[#64f2b3]' : ''}
                ${(signal.status === 'CLOSED' && signal.result === 'TARGET_HIT') ? 'bg-[#173427] text-[#64f2b3]' : ''}
                ${signal.status === 'CLOSED' ? 'bg-[#23314a] text-[#a0b3d4]' : ''}
              `}
            >
              {signal.status}
            </span>
          </div>
        </div>

        {!isExpanded && (
          <div className="mt-4 space-y-3">
            <ConfidenceComparison
              machineConfidenceRaw={signal.confidence}
              aiConfidenceRaw={signal.aiConfidence}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-[#90a4c7]">Target:</span>
                <span className="ml-1 font-semibold text-[#64f2b3]">${signal.target}</span>
                <span className="ml-1 text-[#64f2b3]">(+{profitPercent}%)</span>
              </div>
              <div>
                <span className="text-[#90a4c7]">Stop:</span>
                <span className="ml-1 font-semibold text-[#ff8fa1]">${signal.stopLoss}</span>
                <span className="ml-1 text-[#ff8fa1]">({lossPercent}%)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${getExecutionClass(qualityView.executionQuality)}`}>
                  {qualityView.executionQuality}
                </span>
                <span className="text-xs text-[#8ea2c4]">Slip: {qualityView.slippageRisk}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-[#2a3a55] bg-[#0d1728] p-5">
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

          <div className="mb-6">
            <ConfidenceComparison
              machineConfidenceRaw={signal.confidence}
              aiConfidenceRaw={signal.aiConfidence}
              expanded
            />
            <p className="mt-2 text-xs text-[#8ea2c4]">
              Overall quality: <span className="font-semibold text-[#dbe7fb]">{signal.signalQuality || getConfLabel(conf)}</span>
            </p>
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

          {signal.groqInsight && (
            <div className="mb-4 p-4 bg-[#0f1e35] border border-[#2a1e5f] rounded-xl">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider mb-2 font-semibold flex items-center gap-2">
                <span className="text-[#a78bfa]">🤖</span> Grok AI
              </p>
              <p className="text-sm text-[#c8d8f0] leading-relaxed">{signal.groqInsight}</p>
            </div>
          )}

          {signal.nvidiaInsight && (
            <div className="mb-4 p-4 bg-[#0f1f1f] border border-[#1f5f56] rounded-xl">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider mb-2 font-semibold flex items-center gap-2">
                <span className="text-[#58d7c4]">🤖</span> NVIDIA AI
              </p>
              <p className="text-sm text-[#c8f0eb] leading-relaxed">{signal.nvidiaInsight}</p>
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
                  if (!canTrade) {
                    if (onRequireAuth) onRequireAuth()
                    return
                  }
                  onTake(signal._id)
                }}
                disabled={actionLoading === signal._id}
                className="
                  flex-1 px-6 py-3 text-sm font-bold bg-[#19c37d] text-white
                  rounded-xl hover:bg-[#13a96b]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all transform hover:scale-[1.02] active:scale-[0.98]
                "
              >
                {actionLoading === signal._id ? 'Processing...' : canTrade ? 'Take Trade' : 'Login To Take Trade'}
              </button>
            </div>
          ) : (
            <div className="p-4 bg-[#1a2740] rounded-xl border border-[#2d3f5d]">
              <p className="text-sm font-medium text-[#d1dcf0]">
                {signal.result === 'TARGET_HIT' && 'Target Hit: this signal reached its profit target.'}
                {signal.result === 'SL_HIT' && 'Stop Loss Hit: this signal hit the stop loss.'}
                {signal.result === 'EXPIRED' && 'Signal Expired: validity window ended before target or stop loss.'}
                {signal.result === 'PENDING' && 'Signal closed without target or stop loss hit.'}
              </p>
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

const Signals = ({ signals, loading, actionLoading, onTake, qualityBySymbol = {}, qualityApiFailed = false, canTrade = false, onRequireAuth }) => {
  const [expandedId, setExpandedId] = useState(null)
  const generatedRef = useRef(null)
  const targetHitRef = useRef(null)
  const slHitRef = useRef(null)
  const expiredRef = useRef(null)

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

  const generatedSignals = signals.filter((s) => s.status === 'ACTIVE' || s.status === 'TAKEN')
  const targetHitSignals = signals.filter((s) => s.result === 'TARGET_HIT')
  const slHitSignals = signals.filter((s) => s.result === 'SL_HIT')
  const expiredSignals = signals.filter((s) => s.result === 'EXPIRED')

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
          onRequireAuth={onRequireAuth}
        />
      ))}
    </div>
  )

  const jumpToSection = (sectionRef) => {
    if (!sectionRef?.current) return
    sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Signal Vault</h2>
        <p className="text-[#8ea2c4] text-sm mt-1">
          {generatedSignals.length} generated | {targetHitSignals.length} target hit | {slHitSignals.length} SL hit | {expiredSignals.length} expired
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
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
        </div>
        {qualityApiFailed && (
          <p className="text-xs text-[#ffd56a] mt-2">
            Market quality feed unavailable. Showing fallback labels.
          </p>
        )}
      </div>

      <div className="space-y-4">
        {generatedSignals.length > 0 && (
          <div ref={generatedRef} className="scroll-mt-24">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#f0b90b] rounded-full"></span>
              Generated Signals ({generatedSignals.length})
            </h3>
            {renderSignalGroup(generatedSignals)}
          </div>
        )}

        {targetHitSignals.length > 0 && (
          <div ref={targetHitRef} className="mt-8 scroll-mt-24">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#19c37d] rounded-full"></span>
              Target Hit Signals ({targetHitSignals.length})
            </h3>
            {renderSignalGroup(targetHitSignals)}
          </div>
        )}

        {slHitSignals.length > 0 && (
          <div ref={slHitRef} className="mt-8 scroll-mt-24">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#ff8fa1] rounded-full"></span>
              SL Hit Signals ({slHitSignals.length})
            </h3>
            {renderSignalGroup(slHitSignals)}
          </div>
        )}

        {expiredSignals.length > 0 && (
          <div ref={expiredRef} className="mt-8 scroll-mt-24">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#a8b8d7] rounded-full"></span>
              Expired Signals ({expiredSignals.length})
            </h3>
            {renderSignalGroup(expiredSignals)}
          </div>
        )}
      </div>
    </div>
  )
}


export default Signals

