import { useEffect, useMemo, useState } from 'react'
import { getMarketChart } from '../services/api'

const CHART_INTERVAL_OPTIONS = ['5m', '15m', '1h', '4h']
const CHART_LIMIT_BY_INTERVAL = {
  '5m': 96,
  '15m': 96,
  '1h': 120,
  '4h': 120
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

const SignalCard = ({ signal, isExpanded, onToggle, actionLoading, onTake, onMiss, qualityData, qualityApiFailed }) => {
  const conf = signal.confidence ?? 0
  const isActive = signal.status !== 'CLOSED'
  const isTaken = signal.status === 'TAKEN'
  const isMissed = signal.status === 'MISSED'
  const [timeLeft, setTimeLeft] = useState('')
  const [chartInterval, setChartInterval] = useState('15m')
  const [chartDataByInterval, setChartDataByInterval] = useState({})
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const qualityView = getSignalQualityView(qualityData, qualityApiFailed)

  useEffect(() => {
    if (!signal.expireAt) return

    const updateTimer = () => {
      const now = Date.now()
      const expire = new Date(signal.expireAt).getTime()
      const diff = expire - now

      if (diff <= 0) {
        setTimeLeft('Expired')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      setTimeLeft(hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 60000)
    return () => clearInterval(interval)
  }, [signal.expireAt])

  useEffect(() => {
    setChartInterval('15m')
    setChartDataByInterval({})
    setChartError('')
  }, [signal?.coin])

  useEffect(() => {
    if (!isExpanded || !signal?.coin || chartLoading) return
    if (chartDataByInterval[chartInterval]) return

    let active = true
    setChartLoading(true)
    setChartError('')

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
    }
  }, [isExpanded, signal?.coin, chartInterval, chartDataByInterval, chartLoading])

  const getConfLabel = (c) => {
    if (c >= 80) return 'STRONG'
    if (c >= 65) return 'NORMAL'
    if (c >= 50) return 'WEAK'
    return 'LOW'
  }

  const getConfClass = (c) => {
    if (c >= 80) return 'bg-[#173427] text-[#64f2b3] border-[#2a6b4e]'
    if (c >= 65) return 'bg-[#162a45] text-[#8fc3ff] border-[#34527c]'
    if (c >= 50) return 'bg-[#3a2d10] text-[#ffd56a] border-[#6b551f]'
    return 'bg-[#2f394d] text-[#c3d0e8] border-[#475772]'
  }

  const profitPercent = ((signal.target - signal.entryPrice) / signal.entryPrice * 100).toFixed(2)
  const lossPercent = ((signal.stopLoss - signal.entryPrice) / signal.entryPrice * 100).toFixed(2)
  const reason = signal.reason || {}
  const chartPoints = chartDataByInterval[chartInterval] || []

  return (
    <div
      className={`
        bg-[#111b2d]/95 border rounded-2xl overflow-hidden transition-all duration-300
        ${isExpanded ? 'border-[#f0b90b]/50 shadow-[0_20px_36px_rgba(5,8,15,0.52)]' : 'border-[#2a3a55] hover:border-[#3b4f73]'}
        ${conf < 50 ? 'opacity-70' : ''}
        ${isTaken ? 'ring-2 ring-[#19c37d]/40' : ''}
        ${isMissed ? 'ring-2 ring-[#f6465d]/40' : ''}
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
            <span className={`px-3 py-1 text-sm font-semibold rounded-lg border ${getConfClass(conf)}`}>
              {getConfLabel(conf)}
            </span>

            <span
              className={`
                px-3 py-1 text-xs font-medium rounded-full
                ${signal.status === 'ACTIVE' ? 'bg-[#172b49] text-[#85baff]' : ''}
                ${signal.status === 'TAKEN' ? 'bg-[#173427] text-[#64f2b3]' : ''}
                ${signal.status === 'MISSED' ? 'bg-[#3b1b26] text-[#ff8fa1]' : ''}
                ${signal.status === 'CLOSED' ? 'bg-[#23314a] text-[#a0b3d4]' : ''}
              `}
            >
              {signal.status}
            </span>
          </div>
        </div>

        {!isExpanded && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
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
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-[#2a3a55] bg-[#0d1728] p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
            <div className="bg-[#111b2d] p-4 rounded-xl border border-[#2a3a55]">
              <p className="text-xs text-[#8ea2c4] uppercase tracking-wider">Confidence</p>
              <p className="text-2xl font-bold text-[#f0b90b]">{conf}%</p>
              <p className="text-sm text-[#a1b4d4]">{signal.signalQuality || getConfLabel(conf)}</p>
            </div>
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
              onIntervalChange={setChartInterval}
            />
          </div>

          <div className="mb-4 text-sm text-[#9ab0d3]">
            <p>Trend: <span className="font-semibold text-white">{reason.trend || 'N/A'}</span></p>
            <p>RSI: <span className="font-semibold text-white">{reason.rsi || 'N/A'}</span></p>
            <p>Volume: <span className="font-semibold text-white">{reason.volume || 'N/A'}</span></p>
            <p>News: <span className="font-semibold text-white">{reason.sentiment || 'N/A'}</span></p>
          </div>

          {signal.createdAt && (
            <div className="mb-4 flex items-center gap-4 text-sm text-[#8ea2c4]">
              <span>Generated: {new Date(signal.createdAt).toLocaleString()}</span>
              {timeLeft && (
                <span className={timeLeft === 'Expired' ? 'text-[#f6465d] font-semibold' : 'text-[#ffd56a] font-semibold'}>
                  {timeLeft === 'Expired' ? 'Expired' : `Expires in ${timeLeft}`}
                </span>
              )}
            </div>
          )}

          {isActive ? (
            <div className="flex gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
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
                {actionLoading === signal._id ? 'Processing...' : 'Take Trade'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onMiss(signal._id)
                }}
                disabled={actionLoading === signal._id}
                className="
                  px-6 py-3 text-sm font-bold bg-[#f6465d] text-white
                  rounded-xl hover:bg-[#dd3e53]
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                Miss
              </button>
            </div>
          ) : (
            <div className="p-4 bg-[#1a2740] rounded-xl border border-[#2d3f5d]">
              <p className="text-sm font-medium text-[#d1dcf0]">
                {signal.result === 'TARGET_HIT' && 'Target Hit: this signal reached its profit target.'}
                {signal.result === 'SL_HIT' && 'Stop Loss Hit: this signal hit the stop loss.'}
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

const Signals = ({ signals, loading, actionLoading, onTake, onMiss, qualityBySymbol = {}, qualityApiFailed = false }) => {
  const [expandedId, setExpandedId] = useState(null)

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

  const activeSignals = signals.filter((s) => s.status !== 'CLOSED')
  const closedSignals = signals.filter((s) => s.status === 'CLOSED')
  const singleSignal = activeSignals.length === 1

  if (singleSignal) {
    const signal = activeSignals[0]
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white">New Signal Available</h2>
          <p className="text-[#8ea2c4] text-sm">Review the details below and take action</p>
          {qualityApiFailed && (
            <p className="text-xs text-[#ffd56a] mt-2">
              Market quality feed unavailable. Showing fallback labels.
            </p>
          )}
        </div>

        <div className="max-w-3xl mx-auto">
          <SignalCard
            signal={signal}
            isExpanded={true}
            onToggle={() => {}}
            actionLoading={actionLoading}
            onTake={onTake}
            onMiss={onMiss}
            qualityData={qualityBySymbol?.[signal.coin]}
            qualityApiFailed={qualityApiFailed}
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Trading Signals</h2>
        <p className="text-[#8ea2c4] text-sm mt-1">
          {activeSignals.length} active • {closedSignals.length} completed • {signals.length} total
        </p>
        {qualityApiFailed && (
          <p className="text-xs text-[#ffd56a] mt-2">
            Market quality feed unavailable. Showing fallback labels.
          </p>
        )}
      </div>

      <div className="space-y-4">
        {activeSignals.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#f0b90b] rounded-full"></span>
              Active Signals ({activeSignals.length})
            </h3>
            <div className="space-y-3">
              {activeSignals.map((signal) => (
                <SignalCard
                  key={signal._id}
                  signal={signal}
                  isExpanded={expandedId === signal._id}
                  onToggle={() => setExpandedId(expandedId === signal._id ? null : signal._id)}
                  actionLoading={actionLoading}
                  onTake={onTake}
                  onMiss={onMiss}
                  qualityData={qualityBySymbol?.[signal.coin]}
                  qualityApiFailed={qualityApiFailed}
                />
              ))}
            </div>
          </div>
        )}

        {closedSignals.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-[#8ea2c4] uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-[#5f7294] rounded-full"></span>
              Completed Signals ({closedSignals.length})
            </h3>
            <div className="space-y-3">
              {closedSignals.map((signal) => (
                <SignalCard
                  key={signal._id}
                  signal={signal}
                  isExpanded={expandedId === signal._id}
                  onToggle={() => setExpandedId(expandedId === signal._id ? null : signal._id)}
                  actionLoading={actionLoading}
                  onTake={onTake}
                  onMiss={onMiss}
                  qualityData={qualityBySymbol?.[signal.coin]}
                  qualityApiFailed={qualityApiFailed}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Signals
