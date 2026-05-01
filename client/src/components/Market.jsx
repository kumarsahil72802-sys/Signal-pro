import { memo, useEffect, useMemo, useState } from 'react'
import { getCoinNews, getMarketChart } from '../services/api'

const MARKET_RENDER_CHUNK = 12
const CHART_INTERVALS = ['5m', '15m', '1h', '4h', '1d']
const MARKET_PRESETS = {
  balanced: {
    label: 'Flow Prime',
    hint: 'High liquidity core board',
    move: 'all',
    sort: 'volume',
  },
  momentum: {
    label: 'Lift Wave',
    hint: 'Strong upward acceleration',
    move: 'gainers',
    sort: 'gainers',
  },
  dip: {
    label: 'Rebound Grid',
    hint: 'Oversold rebound radar',
    move: 'losers',
    sort: 'losers',
  },
  largecap: {
    label: 'Titan Core',
    hint: 'Largest market-cap leaders',
    move: 'all',
    sort: 'marketcap',
  },
}
const QUOTE_SUFFIXES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'USDP', 'DAI', 'USDE']
const STABLE_SYMBOLS = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'PYUSD'])

const normalizeTickerSymbol = (value) => String(value || '').trim().toUpperCase()
const formatSourceLabel = (source) => {
  const normalized = String(source || '').trim().toLowerCase()
  if (!normalized) return 'Unknown Source'
  if (normalized === 'binance') return 'Binance Live'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

const buildChartSymbolCandidates = (rawSymbol) => {
  const symbol = normalizeTickerSymbol(rawSymbol)
  if (!symbol || !/^[A-Z0-9]{2,16}$/.test(symbol)) return []
  if (STABLE_SYMBOLS.has(symbol)) return []

  const candidates = []
  const seen = new Set()
  const add = (candidate) => {
    const normalized = normalizeTickerSymbol(candidate)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(normalized)
  }

  if (symbol.endsWith('USDT') && symbol.length > 4) {
    add(symbol)
  } else {
    QUOTE_SUFFIXES.forEach((quote) => {
      if (quote !== symbol) {
        add(`${symbol}${quote}`)
      }
    })
  }

  return candidates
}

const formatPairLabel = (rawPair) => {
  const pair = normalizeTickerSymbol(rawPair)
  if (!pair) return 'N/A'

  const quote = QUOTE_SUFFIXES.find((suffix) => pair.endsWith(suffix) && pair.length > suffix.length)
  if (!quote) return pair
  const base = pair.slice(0, -quote.length)
  return `${base} / ${quote}`
}

const getFallbackLogoUrl = (symbol) => {
  const normalized = String(symbol || '').trim().toLowerCase()
  if (!/^[a-z0-9]{2,16}$/.test(normalized)) return ''
  return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/icon/${normalized}.png`
}

const getLogoCandidates = (symbol, image, imageCandidates) => {
  const candidates = []
  if (Array.isArray(imageCandidates)) {
    imageCandidates.filter(Boolean).forEach((url) => candidates.push(url))
  }
  if (image) candidates.push(image)
  const fallback = getFallbackLogoUrl(symbol)
  if (fallback) candidates.push(fallback)
  return [...new Set(candidates)]
}

const BADGE_TONES = [
  'from-[#1c3f71] to-[#224f86]',
  'from-[#443b1a] to-[#6a5823]',
  'from-[#2a355e] to-[#3b4a76]',
  'from-[#1f4d43] to-[#2a6759]',
  'from-[#58314f] to-[#754267]',
  'from-[#2f3f63] to-[#3f5585]'
]

const getBadgeTone = (symbol) => {
  const clean = String(symbol || '').replace(/[^a-z0-9]/ig, '').toUpperCase()
  const hash = clean.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return BADGE_TONES[hash % BADGE_TONES.length]
}

const formatPrice = (value, maxFractionDigits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  })}`
}

const formatCompactUsd = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}

const formatSupply = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}

const formatSpread = (spreadPct) => {
  if (typeof spreadPct !== 'number') return 'N/A'
  return `${spreadPct.toFixed(4)}%`
}

const formatPressure = (quality, qualityApiFailed) => {
  if (qualityApiFailed || !quality || quality.unavailable) return 'N/A'
  if (typeof quality.imbalanceBuyPct !== 'number' || typeof quality.imbalanceSellPct !== 'number') return 'N/A'
  return `Buy ${quality.imbalanceBuyPct.toFixed(1)}% / Sell ${quality.imbalanceSellPct.toFixed(1)}%`
}

const formatTimeAgo = (unixSeconds) => {
  if (!unixSeconds) return 'Unknown'
  const publishedAt = new Date(unixSeconds * 1000)
  const diffMs = Date.now() - publishedAt.getTime()
  if (diffMs < 60000) return 'Just now'

  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`

  const hours = Math.floor(diffMs / 3600000)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(diffMs / 86400000)
  if (days < 7) return `${days}d ago`

  return publishedAt.toLocaleDateString()
}

const getExecutionBadgeClass = (quality) => {
  if (quality === 'GOOD') return 'bg-[#173427] text-[#64f2b3] border-[#2a6b4e]'
  if (quality === 'MODERATE') return 'bg-[#3a2d10] text-[#ffd56a] border-[#6b551f]'
  if (quality === 'RISKY') return 'bg-[#3b1b26] text-[#ff8fa1] border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border-[#30435f]'
}

const CoinIcon = ({ symbol, name, image, imageCandidates }) => {
  const logoCandidates = getLogoCandidates(symbol, image, imageCandidates)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const initials = String(symbol || '?').replace(/[^a-z0-9]/ig, '').toUpperCase().slice(0, 2) || '?'
  const logoSrc = logoCandidates[candidateIndex] || ''

  useEffect(() => {
    setCandidateIndex(0)
  }, [symbol, image])

  if (!logoSrc) {
    return (
      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getBadgeTone(symbol)} border border-[#3b5380] flex items-center justify-center text-[#f6dd98] font-bold text-xs shadow-sm`}>
        {initials}
      </div>
    )
  }

  return (
    <img
      src={logoSrc}
      alt={name || symbol}
      className="w-10 h-10 rounded-full object-cover shadow-sm border border-[#31435f]"
      onError={() => setCandidateIndex((current) => current + 1)}
      loading="lazy"
    />
  )
}

const MiniSparkline = ({ prices, positive }) => {
  if (!Array.isArray(prices) || prices.length < 2) {
    return (
      <div className="h-10 rounded-lg border border-[#253750] bg-[#0f1a2b] flex items-center justify-center text-[10px] text-[#8398bc]">
        No trend
      </div>
    )
  }

  const width = 132
  const height = 38
  const pad = 3
  const sampled = prices.length > 42
    ? prices.filter((_, idx) => idx % Math.ceil(prices.length / 42) === 0)
    : prices
  const min = Math.min(...sampled)
  const max = Math.max(...sampled)
  const range = Math.max(max - min, 1e-9)
  const points = sampled.map((value, idx) => {
    const x = pad + (idx / (sampled.length - 1)) * (width - pad * 2)
    const y = pad + ((max - value) / range) * (height - pad * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-10 rounded-lg border border-[#253750] bg-[#0f1a2b]">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? '#64f2b3' : '#ff8fa1'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const DetailChart = ({ points = [] }) => {
  if (!Array.isArray(points) || points.length < 2) {
    return (
      <div className="h-56 rounded-2xl border border-[#273958] bg-[#0d172a] flex items-center justify-center text-sm text-[#8ea2c4]">
        Chart unavailable for this interval
      </div>
    )
  }

  const values = points.map((point) => point.close).filter((value) => Number.isFinite(value))
  if (values.length < 2) {
    return (
      <div className="h-56 rounded-2xl border border-[#273958] bg-[#0d172a] flex items-center justify-center text-sm text-[#8ea2c4]">
        Chart unavailable for this interval
      </div>
    )
  }

  const width = 820
  const height = 240
  const padX = 22
  const padY = 18
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 1e-9)

  const linePoints = values.map((value, index) => {
    const x = padX + (index / (values.length - 1)) * (width - padX * 2)
    const y = padY + ((max - value) / range) * (height - padY * 2)
    return { x, y }
  })

  const linePath = linePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  const fillPath = `${linePath} L ${linePoints[linePoints.length - 1].x.toFixed(2)} ${(height - padY).toFixed(2)} L ${linePoints[0].x.toFixed(2)} ${(height - padY).toFixed(2)} Z`
  const isPositive = values[values.length - 1] >= values[0]

  return (
    <div className="rounded-2xl border border-[#273958] bg-[#0d172a] p-3 sm:p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? '#19c37d' : '#f6465d'} stopOpacity="0.36" />
            <stop offset="100%" stopColor={isPositive ? '#19c37d' : '#f6465d'} stopOpacity="0" />
          </linearGradient>
        </defs>

        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#29405f" strokeWidth="1" />
        <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="#29405f" strokeWidth="1" />

        <path d={fillPath} fill="url(#chartFill)" />
        <path
          d={linePath}
          fill="none"
          stroke={isPositive ? '#64f2b3' : '#ff8fa1'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="mt-3 flex items-center justify-between text-xs text-[#8ea2c4]">
        <span>Low {formatPrice(min, 6)}</span>
        <span>High {formatPrice(max, 6)}</span>
      </div>
    </div>
  )
}

const StatCard = ({ label, value }) => (
  <div className="rounded-xl border border-[#2c3f61] bg-[#101b30] p-3">
    <p className="text-[11px] uppercase tracking-wide text-[#8198be]">{label}</p>
    <p className="mt-1 text-sm sm:text-base font-semibold text-white">{value}</p>
  </div>
)

const toFiniteNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const clampPercent = (value) => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

const formatSignedPercent = (value, digits = 2) => {
  if (!Number.isFinite(value)) return 'N/A'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

const getVolatilityTone = (volatilityPct) => {
  if (!Number.isFinite(volatilityPct)) return 'Unknown'
  if (volatilityPct >= 12) return 'Explosive'
  if (volatilityPct >= 7) return 'Elevated'
  if (volatilityPct >= 3) return 'Active'
  return 'Compressed'
}

const buildCoinNarrative = ({ isPositive, distanceToAthPct, volumeToCapPct, newsBias }) => {
  const move = isPositive ? 'buyers controlling intraday flow' : 'sellers currently dictating momentum'
  const ath = Number.isFinite(distanceToAthPct)
    ? (distanceToAthPct <= -45 ? 'still far from cycle highs' : 'holding relatively close to peak structure')
    : 'long-cycle distance to ATH is unclear'
  const liquidity = Number.isFinite(volumeToCapPct)
    ? (volumeToCapPct >= 18 ? 'turnover is high for its size' : 'turnover is moderate, watch conviction candles')
    : 'turnover data is limited'
  const headline = newsBias === 'Bullish'
    ? 'headlines are skewed optimistic'
    : newsBias === 'Bearish'
      ? 'headline tone is risk-aware'
      : 'headline tone is mixed'

  return `${move}; ${ath}; ${liquidity}; ${headline}.`
}

const scoreNewsBias = (articles = []) => {
  if (!Array.isArray(articles) || articles.length === 0) return { label: 'Neutral', score: 50 }
  const positiveWords = ['surge', 'rally', 'breakout', 'adoption', 'approval', 'record', 'bull', 'growth', 'gain']
  const negativeWords = ['hack', 'drop', 'lawsuit', 'selloff', 'ban', 'bear', 'decline', 'risk', 'outflow']

  let score = 0
  articles.forEach((article) => {
    const title = String(article?.title || '').toLowerCase()
    positiveWords.forEach((word) => {
      if (title.includes(word)) score += 1
    })
    negativeWords.forEach((word) => {
      if (title.includes(word)) score -= 1
    })
  })

  if (score >= 3) return { label: 'Bullish', score: 76 }
  if (score <= -3) return { label: 'Bearish', score: 24 }
  return { label: 'Neutral', score: 50 }
}

const InsightMeter = ({ label, value, score = 0, tone = 'cyan', hint }) => {
  const tones = {
    cyan: 'from-[#53d8ff] to-[#2d8be9]',
    green: 'from-[#6af2ba] to-[#2eb872]',
    amber: 'from-[#ffd477] to-[#ff9f3e]',
    rose: 'from-[#ff9db0] to-[#f45d76]',
  }

  const toneClass = tones[tone] || tones.cyan

  return (
    <div className="rounded-xl border border-[#2b4369] bg-[#0e1b33] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#8faad2]">{label}</p>
        <p className="text-sm font-semibold text-white">{value}</p>
      </div>
      <div className="mt-2 h-2 rounded-full bg-[#1a2e4f] overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${toneClass}`} style={{ width: `${clampPercent(score)}%` }} />
      </div>
      {hint && <p className="mt-2 text-[11px] text-[#91a9ce]">{hint}</p>}
    </div>
  )
}

const MarketCard = memo(function MarketCard({ coin, quality, qualityApiFailed, onSelect }) {
  const isPositive = coin.price_change_percentage_24h >= 0
  const changeColor = isPositive ? 'text-[#64f2b3]' : 'text-[#ff8fa1]'
  const bgColor = isPositive ? 'bg-[#112b23]' : 'bg-[#341c25]'
  const executionQuality = (!qualityApiFailed && quality?.executionQuality) ? quality.executionQuality : 'N/A'
  const slippageRisk = (!qualityApiFailed && quality?.slippageRisk) ? quality.slippageRisk : 'N/A'
  const sparklinePrices = coin?.sparkline_in_7d?.price || []

  return (
    <button
      type="button"
      onClick={() => onSelect(coin)}
      className="group relative overflow-hidden text-left rounded-2xl border border-[#2f466a] bg-[linear-gradient(155deg,#101d34_0%,#12233f_53%,#0e1b32_100%)] p-4 transition-all duration-300 hover:border-[#4f709e] hover:-translate-y-1 hover:shadow-[0_24px_40px_rgba(4,8,18,0.58)]"
    >
      <span className="pointer-events-none absolute left-0 top-0 h-full w-1.5 bg-[linear-gradient(180deg,#ffbe2e_0%,#5fd5ff_100%)] opacity-75" />
      <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_85%_0%,rgba(95,213,255,0.18),transparent_40%)]" />

      <div className="flex items-center gap-3 mb-3">
        <CoinIcon
          symbol={coin.symbol}
          name={coin.name}
          image={coin.image}
          imageCandidates={coin.image_candidates}
        />
        <div className="min-w-0">
          <p className="font-bold text-sm text-white truncate">{coin.symbol?.toUpperCase()}</p>
          <p className="text-xs text-[#8ea2c4] truncate">{coin.name}</p>
        </div>
      </div>

      <p className="text-[1.75rem] leading-none font-extrabold text-white tracking-tight">
        {formatPrice(coin.current_price)}
      </p>

      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold mt-2 ${bgColor} ${changeColor}`}>
        <span>{isPositive ? 'UP' : 'DN'}</span>
        {coin.price_change_percentage_24h != null
          ? `${Math.abs(coin.price_change_percentage_24h).toFixed(2)}%`
          : 'N/A'
        }
      </div>

      <div className="mt-3">
        <MiniSparkline prices={sparklinePrices} positive={isPositive} />
      </div>

      <div className="mt-3 pt-3 border-t border-[#2a4468] space-y-1">
        <p className="text-[11px] text-[#8ea2c4]">Spread: <span className="font-semibold text-[#d8e2f3]">{formatSpread(quality?.spreadPct)}</span></p>
        <p className="text-[11px] text-[#8ea2c4]">Pressure: <span className="font-semibold text-[#d8e2f3]">{formatPressure(quality, qualityApiFailed)}</span></p>
        <div className="flex items-center justify-between gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getExecutionBadgeClass(executionQuality)}`}>
            {executionQuality}
          </span>
          <span className="text-[11px] text-[#8ea2c4]">
            Slip: <span className="font-semibold text-[#d8e2f3]">{slippageRisk}</span>
          </span>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-[#88a0c8] cc-mono">ENTER to inspect chart + news intelligence</p>
    </button>
  )
}, (prevProps, nextProps) => {
  const prevCoin = prevProps.coin
  const nextCoin = nextProps.coin
  const prevQuality = prevProps.quality
  const nextQuality = nextProps.quality
  const prevSparkline = Array.isArray(prevCoin?.sparkline_in_7d?.price) ? prevCoin.sparkline_in_7d.price : []
  const nextSparkline = Array.isArray(nextCoin?.sparkline_in_7d?.price) ? nextCoin.sparkline_in_7d.price : []
  const prevSparklineLast = prevSparkline.length > 0 ? prevSparkline[prevSparkline.length - 1] : undefined
  const nextSparklineLast = nextSparkline.length > 0 ? nextSparkline[nextSparkline.length - 1] : undefined

  return (
    prevProps.qualityApiFailed === nextProps.qualityApiFailed &&
    prevCoin?.id === nextCoin?.id &&
    prevCoin?.symbol === nextCoin?.symbol &&
    prevCoin?.current_price === nextCoin?.current_price &&
    prevCoin?.price_change_percentage_24h === nextCoin?.price_change_percentage_24h &&
    prevSparkline[0] === nextSparkline[0] &&
    prevSparklineLast === nextSparklineLast &&
    prevQuality?.spreadPct === nextQuality?.spreadPct &&
    prevQuality?.imbalanceBuyPct === nextQuality?.imbalanceBuyPct &&
    prevQuality?.imbalanceSellPct === nextQuality?.imbalanceSellPct &&
    prevQuality?.executionQuality === nextQuality?.executionQuality &&
    prevQuality?.slippageRisk === nextQuality?.slippageRisk
  )
})

function CoinDetailOverlay({ coin, quality, qualityApiFailed, onClose }) {
  const [chartInterval, setChartInterval] = useState('15m')
  const [chartLoading, setChartLoading] = useState(true)
  const [chartError, setChartError] = useState('')
  const [chartPoints, setChartPoints] = useState([])
  const [chartUpdatedAt, setChartUpdatedAt] = useState('')
  const [chartSymbolUsed, setChartSymbolUsed] = useState('')
  const [newsLoading, setNewsLoading] = useState(true)
  const [newsError, setNewsError] = useState('')
  const [coinNews, setCoinNews] = useState([])

  useEffect(() => {
    if (!coin?.symbol) return undefined

    let ignore = false

    const fetchChart = async () => {
      setChartLoading(true)
      setChartError('')
      setChartSymbolUsed('')
      try {
        const candidates = buildChartSymbolCandidates(coin.symbol)
        if (candidates.length === 0) {
          throw new Error('No compatible Binance market pair found for this coin.')
        }

        let response = null
        let selectedPair = ''
        let lastError = null

        for (const candidate of candidates) {
          try {
            response = await getMarketChart(candidate, chartInterval, 96)
            selectedPair = candidate
            break
          } catch (error) {
            lastError = error
          }
        }

        if (!response || !selectedPair) {
          throw lastError || new Error('Chart data unavailable right now')
        }

        if (ignore) return
        const points = Array.isArray(response.data?.points) ? response.data.points : []
        setChartPoints(points)
        setChartUpdatedAt(response.data?.updatedAt || '')
        setChartSymbolUsed(selectedPair)
      } catch (error) {
        if (ignore) return
        setChartPoints([])
        setChartUpdatedAt('')
        setChartSymbolUsed('')
        const apiMessage = error?.response?.data?.message
        if (apiMessage) {
          setChartError(apiMessage)
        } else {
          setChartError(error?.message || 'Unable to load chart right now')
        }
      } finally {
        if (!ignore) setChartLoading(false)
      }
    }

    fetchChart()

    return () => {
      ignore = true
    }
  }, [coin?.symbol, chartInterval])

  useEffect(() => {
    if (!coin?.symbol) return undefined

    let ignore = false

    const fetchCoinNews = async () => {
      setNewsLoading(true)
      setNewsError('')
      try {
        const response = await getCoinNews(coin.symbol.toUpperCase(), 8)
        if (ignore) return
        const items = Array.isArray(response.data) ? response.data : []
        setCoinNews(items)
      } catch (error) {
        if (ignore) return
        setCoinNews([])
        setNewsError(error.response?.data?.message || 'Unable to load latest news')
      } finally {
        if (!ignore) setNewsLoading(false)
      }
    }

    fetchCoinNews()

    return () => {
      ignore = true
    }
  }, [coin?.symbol])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  if (!coin) return null

  const isPositive = (coin.price_change_percentage_24h || 0) >= 0
  const executionQuality = (!qualityApiFailed && quality?.executionQuality) ? quality.executionQuality : 'N/A'
  const chartValues = chartPoints.map((point) => point.close).filter((value) => Number.isFinite(value))
  const chartChangePct = chartValues.length > 1
    ? ((chartValues[chartValues.length - 1] - chartValues[0]) / chartValues[0]) * 100
    : null
  const displayPair = chartSymbolUsed
    ? formatPairLabel(chartSymbolUsed)
    : `${normalizeTickerSymbol(coin.symbol)} / USDT`
  const currentPrice = toFiniteNumber(coin.current_price)
  const low24 = toFiniteNumber(coin.low_24h)
  const high24 = toFiniteNumber(coin.high_24h)
  const ath = toFiniteNumber(coin.ath)
  const marketCap = toFiniteNumber(coin.market_cap)
  const volume24 = toFiniteNumber(coin.total_volume)
  const circulating = toFiniteNumber(coin.circulating_supply)
  const maxSupply = toFiniteNumber(coin.max_supply)
  const totalSupply = toFiniteNumber(coin.total_supply)
  const spreadPct = toFiniteNumber(quality?.spreadPct)
  const buyPressurePct = toFiniteNumber(quality?.imbalanceBuyPct)
  const sellPressurePct = toFiniteNumber(quality?.imbalanceSellPct)
  const rangeWidthPct = (Number.isFinite(low24) && Number.isFinite(high24) && Number.isFinite(currentPrice) && currentPrice > 0)
    ? ((high24 - low24) / currentPrice) * 100
    : null
  const rangePositionPct = (Number.isFinite(low24) && Number.isFinite(high24) && Number.isFinite(currentPrice) && high24 > low24)
    ? ((currentPrice - low24) / (high24 - low24)) * 100
    : null
  const volumeToCapPct = (Number.isFinite(volume24) && Number.isFinite(marketCap) && marketCap > 0)
    ? (volume24 / marketCap) * 100
    : null
  const distanceToAthPct = (Number.isFinite(currentPrice) && Number.isFinite(ath) && ath > 0)
    ? ((currentPrice - ath) / ath) * 100
    : null
  const issuancePct = (Number.isFinite(circulating) && Number.isFinite(maxSupply) && maxSupply > 0)
    ? (circulating / maxSupply) * 100
    : (Number.isFinite(circulating) && Number.isFinite(totalSupply) && totalSupply > 0)
      ? (circulating / totalSupply) * 100
      : null
  const newsBiasMeta = scoreNewsBias(coinNews)
  const newsBias = newsBiasMeta.label
  const researchNarrative = buildCoinNarrative({
    isPositive,
    distanceToAthPct,
    volumeToCapPct,
    newsBias,
  })
  const volatilityTone = getVolatilityTone(rangeWidthPct)
  const buyDominanceScore = Number.isFinite(buyPressurePct) ? buyPressurePct : 50
  const spreadScore = Number.isFinite(spreadPct)
    ? clampPercent(100 - Math.min(spreadPct * 300, 100))
    : 0

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close coin details"
        onClick={onClose}
        className="absolute inset-0 bg-[#02050d]/80 backdrop-blur-sm"
      />

      <div className="relative z-10 h-full overflow-y-auto">
        <div className="min-h-full px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
          <section className="mx-auto max-w-7xl overflow-hidden rounded-3xl border border-[#2a4167] bg-[linear-gradient(150deg,#081326_0%,#0d1f3f_45%,#091733_100%)] shadow-[0_40px_80px_rgba(2,6,17,0.72)]">
            <div className="relative border-b border-[#274168] px-4 py-5 sm:px-6 sm:py-6">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(83,216,255,0.16),transparent_40%),radial-gradient(circle_at_10%_80%,rgba(255,190,46,0.12),transparent_35%)]" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <CoinIcon symbol={coin.symbol} name={coin.name} image={coin.image} imageCandidates={coin.image_candidates} />
                    <div className="min-w-0">
                      <p className="cc-mono text-[11px] uppercase tracking-[0.2em] text-[#8eacd6]">Asset Intelligence Room</p>
                      <h2 className="mt-1 text-2xl sm:text-3xl font-black text-white truncate">{coin.name}</h2>
                      <p className="text-sm text-[#9bb3d8]">{displayPair}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[#395781] bg-[#12223f] px-3 py-1 text-[11px] text-[#c7d8f4] cc-mono">
                      Rank #{coin.market_cap_rank || 'N/A'}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-[11px] cc-mono ${isPositive ? 'border-[#2e6f55] bg-[#123324] text-[#88f3c8]' : 'border-[#6d3243] bg-[#391f2a] text-[#ffb0c0]'}`}>
                      24h {coin.price_change_percentage_24h != null ? formatSignedPercent(coin.price_change_percentage_24h) : 'N/A'}
                    </span>
                    {chartChangePct != null && (
                      <span className={`rounded-full border px-3 py-1 text-[11px] cc-mono ${chartChangePct >= 0 ? 'border-[#2f6e58] bg-[#133428] text-[#89f2c9]' : 'border-[#713345] bg-[#3a202c] text-[#ffb3c3]'}`}>
                        Interval {formatSignedPercent(chartChangePct)}
                      </span>
                    )}
                    <span className={`rounded-full border px-3 py-1 text-[11px] cc-mono ${getExecutionBadgeClass(executionQuality)}`}>
                      Execution {executionQuality}
                    </span>
                    <span className="rounded-full border border-[#3f5f8f] bg-[#152846] px-3 py-1 text-[11px] text-[#c9daf7] cc-mono">
                      Volatility {volatilityTone}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[#35527f] bg-[#13243f] px-3 py-2 text-sm font-semibold text-[#c6d8f6] hover:border-[#5578ad]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 p-4 sm:p-6">
              <div className="xl:col-span-8 space-y-4">
                <div className="rounded-2xl border border-[#2c446d] bg-[linear-gradient(145deg,#0d1a31,#0f2341)] p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-white">Market Structure</p>
                      <p className="text-xs text-[#95acd2] mt-1">Range behavior, intraday trend and execution map</p>
                    </div>
                    <div className="inline-flex p-1 rounded-lg bg-[#111f39] border border-[#2d456f]">
                      {CHART_INTERVALS.map((interval) => (
                        <button
                          key={interval}
                          type="button"
                          onClick={() => setChartInterval(interval)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${chartInterval === interval
                            ? 'bg-[#f0b90b] text-[#1d1400]'
                            : 'text-[#a9bfdf] hover:text-white'
                          }`}
                        >
                          {interval}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    {chartLoading ? (
                      <div className="h-56 rounded-2xl border border-[#2b4268] bg-[#0b172e] flex items-center justify-center">
                        <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-[#f0b90b]" />
                      </div>
                    ) : (
                      <DetailChart points={chartPoints} />
                    )}
                  </div>

                  {chartError && (
                    <p className="mt-3 text-sm text-[#ff9db0]">{chartError}</p>
                  )}
                  {!chartError && chartUpdatedAt && (
                    <p className="mt-3 text-xs text-[#8da6ce]">
                      Source Binance | Updated {new Date(chartUpdatedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <InsightMeter
                    label="Range Occupancy"
                    value={Number.isFinite(rangePositionPct) ? `${clampPercent(rangePositionPct).toFixed(1)}%` : 'N/A'}
                    score={Number.isFinite(rangePositionPct) ? rangePositionPct : 0}
                    tone="cyan"
                    hint="How close current price is to the 24h high."
                  />
                  <InsightMeter
                    label="Volume Intensity"
                    value={Number.isFinite(volumeToCapPct) ? `${volumeToCapPct.toFixed(2)}%` : 'N/A'}
                    score={Number.isFinite(volumeToCapPct) ? Math.min(volumeToCapPct * 3.5, 100) : 0}
                    tone="amber"
                    hint="24h volume compared with market cap."
                  />
                  <InsightMeter
                    label="Buy Pressure"
                    value={Number.isFinite(buyPressurePct) && Number.isFinite(sellPressurePct) ? `${buyPressurePct.toFixed(1)} / ${sellPressurePct.toFixed(1)}` : 'N/A'}
                    score={buyDominanceScore}
                    tone="green"
                    hint="Orderbook imbalance from live execution feed."
                  />
                  <InsightMeter
                    label="Spread Efficiency"
                    value={formatSpread(spreadPct)}
                    score={spreadScore}
                    tone="rose"
                    hint="Higher score means tighter spread quality."
                  />
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard label="Market Cap" value={formatCompactUsd(coin.market_cap)} />
                  <StatCard label="24h Volume" value={formatCompactUsd(coin.total_volume)} />
                  <StatCard label="24h High" value={formatPrice(coin.high_24h)} />
                  <StatCard label="24h Low" value={formatPrice(coin.low_24h)} />
                  <StatCard label="Distance To ATH" value={formatSignedPercent(distanceToAthPct)} />
                  <StatCard label="24h Range Width" value={formatSignedPercent(rangeWidthPct)} />
                  <StatCard label="Circulating" value={formatSupply(coin.circulating_supply)} />
                  <StatCard label="Supply Issued" value={Number.isFinite(issuancePct) ? `${issuancePct.toFixed(1)}%` : 'N/A'} />
                </div>
              </div>

              <aside className="xl:col-span-4 space-y-4">
                <div className="rounded-2xl border border-[#304870] bg-[linear-gradient(145deg,#101f39,#0f1b33)] p-4 sm:p-5">
                  <p className="cc-mono text-[11px] uppercase tracking-[0.18em] text-[#91aed8]">Deep Dive Thesis</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#d7e3f8]">{researchNarrative}</p>
                  <div className="mt-4 space-y-2 text-xs text-[#9fb6da]">
                    <p>Price now: <span className="font-semibold text-white">{formatPrice(coin.current_price, 6)}</span></p>
                    <p>Distance to ATH: <span className="font-semibold text-white">{formatSignedPercent(distanceToAthPct)}</span></p>
                    <p>Liquidity turnover: <span className="font-semibold text-white">{Number.isFinite(volumeToCapPct) ? `${volumeToCapPct.toFixed(2)}%` : 'N/A'}</span></p>
                    <p>News bias signal: <span className="font-semibold text-white">{newsBias}</span></p>
                    <p>Slippage risk: <span className="font-semibold text-white">{(!qualityApiFailed && quality?.slippageRisk) || 'N/A'}</span></p>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#304870] bg-[#0f1b33] p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-bold text-white">Narrative Feed</h3>
                    <span className="cc-mono rounded-full border border-[#3c5b87] bg-[#12233f] px-2.5 py-1 text-[10px] text-[#9cb5dc]">
                      {coinNews.length} stories
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#90a5ca]">Latest {coin.symbol?.toUpperCase()} context to validate trend strength</p>

                  {newsLoading ? (
                    <div className="mt-4 space-y-3">
                      {[...Array(4)].map((_, idx) => (
                        <div key={idx} className="rounded-lg border border-[#253957] bg-[#111f37] p-3">
                          <div className="h-3 w-24 rounded bg-[#243a59] animate-pulse" />
                          <div className="mt-2 h-4 w-full rounded bg-[#213452] animate-pulse" />
                          <div className="mt-1 h-4 w-4/5 rounded bg-[#213452] animate-pulse" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3 max-h-[360px] overflow-auto pr-1">
                      {coinNews.length === 0 && !newsError && (
                        <p className="text-sm text-[#8ea2c4]">No fresh headlines found for this coin yet.</p>
                      )}
                      {newsError && (
                        <p className="text-sm text-[#ff9db0]">{newsError}</p>
                      )}
                      {coinNews.map((article) => (
                        <a
                          key={article.id || article.guid || article.url || article.title}
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg border border-[#263c5d] bg-[#111f37] p-3 hover:border-[#3a5780]"
                        >
                          <p className="text-[11px] text-[#86a2cc]">{article.source || 'Unknown'}  {formatTimeAgo(article.published_on)}</p>
                          <p className="mt-1 text-sm font-semibold text-[#e4edfb] leading-snug line-clamp-2">{article.title || 'Untitled headline'}</p>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-[#304870] bg-[#101f37] p-4 text-xs text-[#9ab0d3] space-y-2">
                  <p>Order Pressure: <span className="font-semibold text-white">{formatPressure(quality, qualityApiFailed)}</span></p>
                  <p>Spread: <span className="font-semibold text-white">{formatSpread(quality?.spreadPct)}</span></p>
                  <p>News Bias Meter: <span className="font-semibold text-white">{newsBiasMeta.label} ({newsBiasMeta.score}/100)</span></p>
                  <p>Total Supply: <span className="font-semibold text-white">{formatSupply(coin.total_supply)}</span></p>
                  <p>ATH: <span className="font-semibold text-white">{formatPrice(coin.ath)}</span></p>
                  <p>ATL: <span className="font-semibold text-white">{formatPrice(coin.atl)}</span></p>
                </div>
              </aside>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

const Market = ({ market, loading, qualityBySymbol = {}, qualityApiFailed = false }) => {
  const [visibleCount, setVisibleCount] = useState(MARKET_RENDER_CHUNK)
  const [selectedCoinKey, setSelectedCoinKey] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [marketPreset, setMarketPreset] = useState('balanced')
  const [sourceFilter, setSourceFilter] = useState('all')
  const activePreset = MARKET_PRESETS[marketPreset] || MARKET_PRESETS.balanced
  const browseStateKey = `${marketPreset}|${sourceFilter}|${searchQuery.trim().toLowerCase()}`
  const sourceOptions = useMemo(() => {
    const sources = [...new Set(
      market
        .map((coin) => String(coin.source || '').trim().toLowerCase())
        .filter(Boolean)
    )]

    if (sources.length === 0) {
      return [{ value: 'all', label: 'All Markets' }]
    }

    if (sources.length === 1) {
      return [{ value: 'all', label: formatSourceLabel(sources[0]) }]
    }

    return [
      { value: 'all', label: 'All Sources' },
      ...sources.map((source) => ({ value: source, label: formatSourceLabel(source) }))
    ]
  }, [market])
  const effectiveSourceFilter = sourceOptions.some((option) => option.value === sourceFilter) ? sourceFilter : 'all'

  const marketPulse = useMemo(() => {
    const samples = market
      .map((coin) => Number(coin.price_change_percentage_24h))
      .filter((value) => Number.isFinite(value))

    if (samples.length === 0) {
      return { label: 'Neutral Drift', tone: 'text-[#9db5db]', chip: 'border-[#355170] bg-[#142640]' }
    }

    const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length
    if (avg >= 2) return { label: 'Risk-On Surge', tone: 'text-[#42e2ab]', chip: 'border-[#2f6c57] bg-[#133226]' }
    if (avg > 0) return { label: 'Constructive Bias', tone: 'text-[#91e6bd]', chip: 'border-[#3e6f5a] bg-[#183628]' }
    if (avg <= -2) return { label: 'Heavy Drawdown', tone: 'text-[#ff92ab]', chip: 'border-[#6e3242] bg-[#3a1b26]' }
    return { label: 'Risk-Off Chop', tone: 'text-[#ffc477]', chip: 'border-[#6f5a2b] bg-[#362812]' }
  }, [market])

  const filteredMarket = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return market.filter((coin) => {
      const symbol = String(coin.symbol || '').toLowerCase()
      const symbolUpper = String(coin.symbol || '').toUpperCase()
      const name = String(coin.name || '').toLowerCase()
      const source = String(coin.source || '').toLowerCase()
      const change = Number(coin.price_change_percentage_24h)

      const matchesQuery = !query || symbol.includes(query) || name.includes(query)
      const matchesMove = activePreset.move === 'all'
        || (activePreset.move === 'gainers' && Number.isFinite(change) && change > 0)
        || (activePreset.move === 'losers' && Number.isFinite(change) && change < 0)
      const matchesSource = effectiveSourceFilter === 'all' || effectiveSourceFilter === source

      const supportedSymbol = symbolUpper && !STABLE_SYMBOLS.has(symbolUpper)
      return supportedSymbol && matchesQuery && matchesMove && matchesSource
    })
  }, [activePreset.move, effectiveSourceFilter, market, searchQuery])

  const sortedMarket = useMemo(() => {
    const list = filteredMarket.slice()

    const toFinite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

    if (activePreset.sort === 'gainers') {
      return list.sort((a, b) => toFinite(b.price_change_percentage_24h, -Infinity) - toFinite(a.price_change_percentage_24h, -Infinity))
    }
    if (activePreset.sort === 'losers') {
      return list.sort((a, b) => toFinite(a.price_change_percentage_24h, Infinity) - toFinite(b.price_change_percentage_24h, Infinity))
    }
    if (activePreset.sort === 'marketcap') {
      return list.sort((a, b) => (Number(b.market_cap) || 0) - (Number(a.market_cap) || 0))
    }

    return list.sort((a, b) => (Number(b.total_volume) || 0) - (Number(a.total_volume) || 0))
  }, [activePreset.sort, filteredMarket])

  useEffect(() => {
    setVisibleCount(MARKET_RENDER_CHUNK)
  }, [browseStateKey])

  useEffect(() => {
    setVisibleCount((current) => {
      if (sortedMarket.length === 0) return 0
      if (current > sortedMarket.length) return sortedMarket.length
      if (current < MARKET_RENDER_CHUNK) return Math.min(MARKET_RENDER_CHUNK, sortedMarket.length)
      return current
    })
  }, [sortedMarket.length])

  const visibleMarket = useMemo(() => sortedMarket.slice(0, visibleCount), [sortedMarket, visibleCount])
  const hasMoreCoins = visibleCount < sortedMarket.length
  const browseProgress = sortedMarket.length > 0
    ? Math.min(100, (visibleMarket.length / sortedMarket.length) * 100)
    : 0

  const selectedCoin = useMemo(() => {
    if (!selectedCoinKey) return null
    return market.find((coin) => (coin.id || coin.symbol) === selectedCoinKey) || null
  }, [market, selectedCoinKey])

  const selectedQuality = useMemo(() => {
    if (!selectedCoin?.symbol) return null
    const pair = `${selectedCoin.symbol.toUpperCase()}USDT`
    return qualityBySymbol?.[pair] || null
  }, [selectedCoin, qualityBySymbol])

  const handleCoinSelect = (coin) => {
    setSelectedCoinKey(coin.id || coin.symbol || null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f0b90b]"></div>
      </div>
    )
  }

  if (market.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-[#a4b6d6] text-lg">No market data available</p>
        <p className="text-[#6f83a6] text-sm mt-2">Check your connection and try again</p>
      </div>
    )
  }

  return (
    <div>
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-[#2f476f] bg-[linear-gradient(130deg,#0d1b30_0%,#132b4c_52%,#0f2039_100%)] px-5 py-6 sm:px-7 sm:py-7 cc-noise">
        <div className="pointer-events-none absolute -left-14 -top-20 h-48 w-48 rounded-full border border-[#ffbe2e]/25 cc-orbit" />
        <div className="pointer-events-none absolute -right-20 -bottom-24 h-72 w-72 rounded-full border border-[#5fd5ff]/20 cc-orbit" style={{ animationDuration: '34s' }} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="cc-mono text-[11px] uppercase tracking-[0.2em] text-[#8eaad2]">CoinChakra Observatory</p>
            <h2 className="mt-1 text-3xl sm:text-[2.2rem] font-black text-white tracking-tight">Market Depth Matrix</h2>
            <p className="text-[#a0b7da] text-sm mt-2 max-w-2xl">Tap any coin for execution-grade spread signals, trend map, and curated headline context in one flow.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`cc-mono rounded-full border px-3 py-1 text-[11px] ${marketPulse.chip} ${marketPulse.tone}`}>
              Pulse: {marketPulse.label}
            </span>
            <span className="cc-mono rounded-full border border-[#365071] bg-[#142742] px-3 py-1 text-[11px] text-[#9ab5dc]">
              Tracked: {market.length}
            </span>
            <span className="cc-mono rounded-full border border-[#365071] bg-[#142742] px-3 py-1 text-[11px] text-[#9ab5dc]">
              Source: {sourceOptions.find((option) => option.value === effectiveSourceFilter)?.label || 'All Markets'}
            </span>
          </div>
        </div>
        {qualityApiFailed && (
          <p className="text-xs text-[#ffd56a] mt-3">
            Execution quality data is temporarily unavailable. Showing fallback labels.
          </p>
        )}
      </div>

      <div className="mb-5 rounded-2xl border border-[#33507a] bg-[linear-gradient(148deg,#0d1a30_0%,#122747_53%,#0f1f39_100%)] p-4 sm:p-5 cc-noise">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ba8d2] mb-2">
              Search Asset
            </label>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Type BTC, ETH, SOL or full coin name..."
              className="w-full rounded-xl border border-[#40608f] bg-[#0b162a] px-4 py-3 text-sm text-[#e3ebfa] placeholder-[#809ac3] outline-none focus:border-[#ffbe2e]"
            />
          </div>

          <div className="w-full lg:w-64">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ba8d2] mb-2">
              Data Source
            </label>
            <select
              value={effectiveSourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="w-full rounded-xl border border-[#40608f] bg-[#0b162a] px-3 py-3 text-sm text-[#dce8fb] outline-none focus:border-[#ffbe2e]"
            >
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {Object.entries(MARKET_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMarketPreset(key)}
              className={`text-left rounded-xl border p-3 transition-all ${marketPreset === key
                ? 'border-[#ffbe2e] bg-[linear-gradient(140deg,#33270f,#2e2410)] shadow-[0_12px_24px_rgba(255,190,46,0.16)]'
                : 'border-[#35527f] bg-[#12203a] hover:border-[#5377ac] hover:-translate-y-0.5'
              }`}
            >
              <p className={`text-sm font-bold ${marketPreset === key ? 'text-[#ffe08d]' : 'text-[#d8e3f6]'}`}>{preset.label}</p>
              <p className="text-[11px] text-[#8ba4cc] mt-1">{preset.hint}</p>
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-[#91acd2]">
          Active mode: <span className="text-[#ffd782] font-semibold">{activePreset.label}</span> | Showing {visibleMarket.length} of {sortedMarket.length} filtered coins ({market.length} total live tracked)
        </p>
      </div>

      {sortedMarket.length === 0 ? (
        <div className="rounded-2xl border border-[#2c4266] bg-[#0f1a2f] p-10 text-center">
          <p className="text-[#c4d2ea] text-lg font-semibold">No coins matched your filter</p>
          <p className="text-[#7f97bf] text-sm mt-1">Try a shorter search or switch market mode to `Flow Prime`.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {visibleMarket.map((coin) => {
              const pair = `${coin.symbol?.toUpperCase()}USDT`
              const quality = qualityBySymbol?.[pair]

              return (
                <div key={coin.id || coin.symbol} className="relative">
                  {coin.source === 'binance' && (
                    <span className="absolute right-2 top-2 z-10 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#173427] text-[#77e7b5] border border-[#2b6e51] cc-mono">
                      Binance
                    </span>
                  )}
                  <MarketCard
                    coin={coin}
                    quality={quality}
                    qualityApiFailed={qualityApiFailed}
                    onSelect={handleCoinSelect}
                  />
                </div>
              )
            })}
          </div>

          {hasMoreCoins && (
            <div className="mt-7 rounded-2xl border border-[#31507a] bg-[linear-gradient(145deg,#0f1e36,#102441)] p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="cc-mono text-[11px] uppercase tracking-[0.18em] text-[#91aed8]">Market Browser</p>
                  <p className="mt-1 text-sm text-[#c7d7f1]">
                    Showing <span className="font-semibold text-white">{visibleMarket.length}</span> of <span className="font-semibold text-white">{sortedMarket.length}</span> coins.
                    Search above or load more in steps.
                  </p>
                  <div className="mt-3 h-2 w-full max-w-xl rounded-full bg-[#162a48] border border-[#2d486f] overflow-hidden">
                    <div
                      className="h-full bg-[linear-gradient(90deg,#5fd5ff,#ffbe2e)] transition-all duration-300"
                      style={{ width: `${browseProgress.toFixed(2)}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((current) => Math.min(current + MARKET_RENDER_CHUNK, sortedMarket.length))}
                    className="rounded-xl border border-[#3d5d89] bg-[#122643] px-4 py-2 text-sm font-semibold text-[#dce9ff] hover:border-[#638bbb]"
                  >
                    Load Next {Math.min(MARKET_RENDER_CHUNK, sortedMarket.length - visibleCount)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleCount(sortedMarket.length)}
                    className="rounded-xl border border-[#6d5927] bg-[#31270f] px-4 py-2 text-sm font-semibold text-[#ffd98b] hover:border-[#a48435]"
                  >
                    Expand All
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-8 p-4 bg-[linear-gradient(145deg,#0f1b31,#0f1a2d)] rounded-xl border border-[#2f466a]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#ffbe2e] animate-pulse"></span>
          <p className="text-sm text-[#c4d2ea] cc-mono">
            Auto-refresh active | Snapshot {new Date().toLocaleTimeString()}
          </p>
        </div>
      </div>

      {selectedCoin && (
        <CoinDetailOverlay
          coin={selectedCoin}
          quality={selectedQuality}
          qualityApiFailed={qualityApiFailed}
          onClose={() => setSelectedCoinKey(null)}
        />
      )}
    </div>
  )
}

export default Market

