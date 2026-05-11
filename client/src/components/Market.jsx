import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getCoinNews, getMarketChart } from '../services/api'

const MARKET_RENDER_CHUNK = 12
const CHART_INTERVALS = ['1s', '1m', '5m', '15m', '1h', '4h', '1d']
const CHART_VIEWS = [
  { value: 'line', label: 'Line' },
  { value: 'candles', label: 'Candles' },
]
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

const splitMarketPair = (rawPair) => {
  const pair = normalizeTickerSymbol(rawPair)
  if (!pair) return { base: '', quote: '' }

  const quote = QUOTE_SUFFIXES.find((suffix) => pair.endsWith(suffix) && pair.length > suffix.length) || 'USDT'
  const base = pair.endsWith(quote) ? pair.slice(0, -quote.length) : pair
  return { base, quote }
}

const buildBinanceTradeUrl = (rawPair) => {
  const { base, quote } = splitMarketPair(rawPair)
  if (!base || !quote) return ''
  return `https://www.binance.com/en/trade/${base}_${quote}?type=spot`
}

const buildTradingViewChartUrl = (rawPair) => {
  const { base, quote } = splitMarketPair(rawPair)
  if (!base || !quote) return ''
  const symbol = `BINANCE:${base}${quote}`
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`
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

const formatPricePlain = (value, maxFractionDigits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  })
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

const formatDateTime = (value) => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

const buildSparklineDetailPoints = (prices = []) => {
  if (!Array.isArray(prices) || prices.length < 2) return []

  const numericPrices = prices
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

  if (numericPrices.length < 2) return []

  const now = Date.now()
  const stepMs = 60 * 60 * 1000
  const startTs = now - (numericPrices.length - 1) * stepMs

  return numericPrices.map((price, index) => ({
    time: startTs + (index * stepMs),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
  }))
}

const getExecutionBadgeClass = (quality) => {
  if (quality === 'GOOD') return 'bg-[#173427] text-[#64f2b3] border-[#2a6b4e]'
  if (quality === 'MODERATE') return 'bg-[#3a2d10] text-[#ffd56a] border-[#6b551f]'
  if (quality === 'RISKY') return 'bg-[#3b1b26] text-[#ff8fa1] border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border-[#30435f]'
}

const CoinIcon = ({ symbol, name, image, imageCandidates }) => {
  const logoCandidates = getLogoCandidates(symbol, image, imageCandidates)
  const initials = String(symbol || '?').replace(/[^a-z0-9]/ig, '').toUpperCase().slice(0, 2) || '?'
  const logoSrc = logoCandidates[0] || ''

  const handleLogoError = (event) => {
    const target = event.currentTarget
    const currentIndex = Number(target.dataset.idx || '0')
    const nextIndex = currentIndex + 1
    const nextSrc = logoCandidates[nextIndex] || ''

    if (nextSrc) {
      target.dataset.idx = String(nextIndex)
      target.src = nextSrc
      return
    }

    target.style.display = 'none'
    const fallback = target.nextElementSibling
    if (fallback) {
      fallback.style.display = 'flex'
    }
  }

  if (!logoSrc) {
    return (
      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getBadgeTone(symbol)} border border-[#3b5380] flex items-center justify-center text-[#f6dd98] font-bold text-xs shadow-sm`}>
        {initials}
      </div>
    )
  }

  return (
    <div className="relative w-10 h-10">
      <img
        src={logoSrc}
        alt={name || symbol}
        data-idx="0"
        className="w-10 h-10 rounded-full object-cover shadow-sm border border-[#31435f]"
        onError={handleLogoError}
        loading="lazy"
      />
      <div className={`hidden absolute inset-0 w-10 h-10 rounded-full bg-gradient-to-br ${getBadgeTone(symbol)} border border-[#3b5380] items-center justify-center text-[#f6dd98] font-bold text-xs shadow-sm`}>
        {initials}
      </div>
    </div>
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

const DetailChart = ({ points = [], mode = 'line', expanded = false, chartIdPrefix = 'chart' }) => {
  if (!Array.isArray(points) || points.length < 2) {
    return (
      <div className={`${expanded ? 'h-[65vh] min-h-[420px] max-h-[760px]' : 'h-56'} rounded-2xl border border-[#273958] bg-[#0d172a] flex items-center justify-center text-sm text-[#8ea2c4]`}>
        Chart unavailable for this interval
      </div>
    )
  }

  const candles = points
    .map((point, index) => {
      const open = Number(point?.open)
      const high = Number(point?.high)
      const low = Number(point?.low)
      const close = Number(point?.close)
      const time = Number(point?.time)

      if (![open, high, low, close].every((value) => Number.isFinite(value))) return null
      return {
        key: `${time || index}-${index}`,
        time,
        open,
        high,
        low,
        close,
      }
    })
    .filter(Boolean)

  if (candles.length < 2) {
    return (
      <div className={`${expanded ? 'h-[65vh] min-h-[420px] max-h-[760px]' : 'h-56'} rounded-2xl border border-[#273958] bg-[#0d172a] flex items-center justify-center text-sm text-[#8ea2c4]`}>
        Chart unavailable for this interval
      </div>
    )
  }

  const values = candles.map((candle) => candle.close)
  const width = 820
  const height = 240
  const padLeft = 22
  const padRight = 84
  const padTop = 18
  const padBottom = 18
  const chartWidth = width - padLeft - padRight
  const chartHeight = height - padTop - padBottom
  const min = Math.min(...candles.map((candle) => candle.low))
  const max = Math.max(...candles.map((candle) => candle.high))
  const range = Math.max(max - min, 1e-9)
  const priceDigits = Math.abs(max) >= 1 ? 2 : 6

  const linePoints = values.map((value, index) => {
    const x = padLeft + (index / (values.length - 1)) * chartWidth
    const y = padTop + ((max - value) / range) * chartHeight
    return { x, y }
  })

  const linePath = linePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  const fillPath = `${linePath} L ${linePoints[linePoints.length - 1].x.toFixed(2)} ${(height - padBottom).toFixed(2)} L ${linePoints[0].x.toFixed(2)} ${(height - padBottom).toFixed(2)} Z`
  const isPositive = values[values.length - 1] >= values[0]
  const fillId = `${chartIdPrefix}-${mode}-fill`
  const slotWidth = chartWidth / candles.length
  const bodyWidth = Math.max(2.2, Math.min(10, slotWidth * 0.62))
  const yFromPrice = (price) => padTop + ((max - price) / range) * chartHeight
  const chartHeightClass = expanded ? 'h-[65vh] min-h-[420px] max-h-[760px]' : 'h-56'
  const gridRows = [0, 0.25, 0.5, 0.75, 1]
  const latestPrice = candles[candles.length - 1]?.close
  const latestY = yFromPrice(latestPrice)
  const latestLabel = formatPricePlain(latestPrice, priceDigits)
  const latestLineColor = isPositive ? '#64f2b3' : '#ff8fa1'
  const priceAxisX = width - 6
  const priceBadgeX = width - padRight + 6
  const priceBadgeW = 74
  const priceBadgeH = 18
  const priceBadgeY = Math.max(padTop, Math.min((height - padBottom) - priceBadgeH, latestY - (priceBadgeH / 2)))

  return (
    <div className="rounded-2xl border border-[#273958] bg-[#0d172a] p-3 sm:p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className={`w-full ${chartHeightClass}`}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? '#19c37d' : '#f6465d'} stopOpacity="0.36" />
            <stop offset="100%" stopColor={isPositive ? '#19c37d' : '#f6465d'} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridRows.map((ratio) => {
          const y = padTop + (chartHeight * ratio)
          const rowPrice = max - (range * ratio)
          return (
            <g key={`grid-${ratio}`}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#203550"
                strokeWidth="1"
                strokeDasharray={ratio === 1 ? '0' : '4 5'}
              />
              <text
                x={priceAxisX}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="#8ea6cc"
              >
                {formatPricePlain(rowPrice, priceDigits)}
              </text>
            </g>
          )
        })}

        <line x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} stroke="#29405f" strokeWidth="1" />
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} stroke="#29405f" strokeWidth="1" />
        <line x1={width - padRight} y1={padTop} x2={width - padRight} y2={height - padBottom} stroke="#29405f" strokeWidth="1" />
        <line
          x1={padLeft}
          y1={latestY}
          x2={width - padRight}
          y2={latestY}
          stroke={latestLineColor}
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.8"
        />

        {mode === 'candles' ? (
          candles.map((candle, index) => {
            const xCenter = padLeft + (slotWidth * index) + (slotWidth / 2)
            const yOpen = yFromPrice(candle.open)
            const yClose = yFromPrice(candle.close)
            const yHigh = yFromPrice(candle.high)
            const yLow = yFromPrice(candle.low)
            const isGreen = candle.close >= candle.open
            const bodyTop = Math.min(yOpen, yClose)
            const bodyHeight = Math.max(1.4, Math.abs(yClose - yOpen))
            const color = isGreen ? '#64f2b3' : '#ff8fa1'

            return (
              <g key={candle.key}>
                <line
                  x1={xCenter}
                  y1={yHigh}
                  x2={xCenter}
                  y2={yLow}
                  stroke={color}
                  strokeWidth="1.3"
                />
                <rect
                  x={xCenter - (bodyWidth / 2)}
                  y={bodyTop}
                  width={bodyWidth}
                  height={bodyHeight}
                  fill={color}
                  rx="1"
                />
              </g>
            )
          })
        ) : (
          <>
            <path d={fillPath} fill={`url(#${fillId})`} />
            <path
              d={linePath}
              fill="none"
              stroke={isPositive ? '#64f2b3' : '#ff8fa1'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        <rect
          x={priceBadgeX}
          y={priceBadgeY}
          width={priceBadgeW}
          height={priceBadgeH}
          rx="5"
          fill="#152a49"
          stroke={latestLineColor}
          strokeWidth="1"
        />
        <text
          x={priceBadgeX + (priceBadgeW / 2)}
          y={priceBadgeY + 12}
          textAnchor="middle"
          fontSize="10.5"
          fill="#d7e4fb"
          fontWeight="600"
        >
          {latestLabel}
        </text>
      </svg>

      <div className="mt-3 flex items-center justify-between text-xs text-[#8ea2c4]">
        <span>Low {formatPrice(min, 6)}</span>
        <span>High {formatPrice(max, 6)}</span>
      </div>
      {mode === 'candles' && (
        <p className="mt-2 text-[11px] text-[#8aa3cb]">
          Green candle = close above open | Red candle = close below open
        </p>
      )}
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
  const sparklinePrices = coin?.sparkline_in_7d?.price || []
  const spreadLabel = formatSpread(quality?.spreadPct)
  const volumeLabel = formatCompactUsd(Number(coin.total_volume))
  const rankLabel = coin?.market_cap_rank ? `#${coin.market_cap_rank}` : 'N/A'

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
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm text-white truncate">{coin.symbol?.toUpperCase()}</p>
          <p className="text-xs text-[#8ea2c4] truncate">{coin.name}</p>
        </div>
        <span className="shrink-0 rounded-md border border-[#395b87] bg-[#132642] px-2 py-0.5 text-[10px] cc-mono text-[#9fc0ec]">
          {rankLabel}
        </span>
      </div>

      <p className="text-[1.75rem] leading-none font-extrabold text-white tracking-tight">
        {formatPrice(coin.current_price)}
      </p>

      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold mt-2 ${bgColor} ${changeColor}`}>
        24h {formatSignedPercent(coin.price_change_percentage_24h)}
      </div>

      <div className="mt-3">
        <MiniSparkline prices={sparklinePrices} positive={isPositive} />
      </div>

      <div className="mt-3 pt-3 border-t border-[#2a4468] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getExecutionBadgeClass(executionQuality)}`}>
            {executionQuality}
          </span>
          <span className="text-[11px] text-[#8ea2c4]">
            Spread: <span className="font-semibold text-[#d8e2f3]">{spreadLabel}</span>
          </span>
        </div>
        <p className="text-[11px] text-[#8ea2c4]">
          24h Volume: <span className="font-semibold text-[#d8e2f3]">{volumeLabel}</span>
        </p>
      </div>

      <p className="mt-3 text-[11px] text-[#9bb0d3] cc-mono">Tap for full chart + narrative</p>
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

function CoinDetailOverlay({
  coin,
  quality,
  qualityApiFailed,
  onClose,
  onPrevCoin,
  onNextCoin,
  hasPrevCoin = false,
  hasNextCoin = false,
  prevCoinSymbol = '',
  nextCoinSymbol = '',
}) {
  const overlayRef = useRef(null)
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [chartInterval, setChartInterval] = useState('15m')
  const [chartView, setChartView] = useState('line')
  const [chartFullscreen, setChartFullscreen] = useState(false)
  const [chartLoading, setChartLoading] = useState(true)
  const [chartError, setChartError] = useState('')
  const [chartPoints, setChartPoints] = useState([])
  const [chartUpdatedAt, setChartUpdatedAt] = useState('')
  const [chartSymbolUsed, setChartSymbolUsed] = useState('')
  const [newsLoading, setNewsLoading] = useState(true)
  const [newsError, setNewsError] = useState('')
  const [coinNews, setCoinNews] = useState([])
  const [newsSourceLabel, setNewsSourceLabel] = useState('Coin specific')

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
        let items = Array.isArray(response.data) ? response.data : []
        let sourceLabel = 'Coin specific'

        if (items.length === 0) {
          const fallbackResponse = await getCoinNews('', 8)
          if (ignore) return
          items = Array.isArray(fallbackResponse.data) ? fallbackResponse.data : []
          sourceLabel = 'Market context'
        }

        setCoinNews(items)
        setNewsSourceLabel(sourceLabel)
      } catch (error) {
        if (ignore) return
        setCoinNews([])
        setNewsSourceLabel('Coin specific')
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
    const overlayNode = overlayRef.current
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const getFocusableElements = () => {
      if (!overlayNode) return []
      return Array.from(overlayNode.querySelectorAll(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0)
    }

    const focusInitialTarget = () => {
      const preferredTarget = overlayNode?.querySelector('[data-dialog-initial-focus="true"]')
      if (preferredTarget instanceof HTMLElement) {
        preferredTarget.focus()
        return
      }

      const firstFocusable = getFocusableElements()[0]
      if (firstFocusable) {
        firstFocusable.focus()
        return
      }

      dialogRef.current?.focus()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(focusInitialTarget)

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow

      const previousFocusedElement = previousFocusRef.current
      if (previousFocusedElement instanceof HTMLElement && document.contains(previousFocusedElement)) {
        previousFocusedElement.focus({ preventScroll: true })
      }
    }
  }, [])

  useEffect(() => {
    const overlayNode = overlayRef.current
    const getFocusableElements = () => {
      if (!overlayNode) return []
      return Array.from(overlayNode.querySelectorAll(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0)
    }

    const onKeyDown = (event) => {
      if (event.key === 'ArrowLeft' && hasPrevCoin) {
        event.preventDefault()
        onPrevCoin?.()
        return
      }
      if (event.key === 'ArrowRight' && hasNextCoin) {
        event.preventDefault()
        onNextCoin?.()
        return
      }
      if (event.key === 'Escape') {
        if (chartFullscreen) {
          setChartFullscreen(false)
          return
        }
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      const active = document.activeElement
      const isInsideOverlay = overlayNode?.contains(active)

      if (event.shiftKey) {
        if (!isInsideOverlay || active === first) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (!isInsideOverlay || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [chartFullscreen, hasNextCoin, hasPrevCoin, onClose, onNextCoin, onPrevCoin])

  if (!coin) return null

  const isPositive = (coin.price_change_percentage_24h || 0) >= 0
  const dialogTitleId = `coin-detail-title-${String(coin.id || coin.symbol || 'asset').replace(/[^a-z0-9_-]/ig, '').toLowerCase()}`
  const executionQuality = (!qualityApiFailed && quality?.executionQuality) ? quality.executionQuality : 'N/A'
  const fallbackChartPoints = buildSparklineDetailPoints(coin?.sparkline_in_7d?.price)
  const hasLiveChart = chartPoints.length >= 2
  const hasFallbackChart = fallbackChartPoints.length >= 2
  const chartPointsToRender = hasLiveChart ? chartPoints : fallbackChartPoints
  const usingFallbackChart = !hasLiveChart && hasFallbackChart
  const chartValues = chartPointsToRender.map((point) => point.close).filter((value) => Number.isFinite(value))
  const chartChangePct = chartValues.length > 1
    ? ((chartValues[chartValues.length - 1] - chartValues[0]) / chartValues[0]) * 100
    : null
  const activePairSymbol = chartSymbolUsed || `${normalizeTickerSymbol(coin.symbol)}USDT`
  const displayPair = formatPairLabel(activePairSymbol)
  const binanceTradeUrl = buildBinanceTradeUrl(activePairSymbol)
  const tradingViewUrl = buildTradingViewChartUrl(activePairSymbol)
  const currentPrice = toFiniteNumber(coin.current_price)
  const chartLatestPrice = chartValues.length > 0 ? toFiniteNumber(chartValues[chartValues.length - 1]) : null
  const displayChartPrice = Number.isFinite(chartLatestPrice) ? chartLatestPrice : currentPrice
  const chartPriceModeLabel = usingFallbackChart ? 'Cached' : 'Live'
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
  const coreFundamentalCount = [
    marketCap,
    ath,
    coin.atl,
    circulating,
    totalSupply,
    maxSupply,
    high24,
    low24,
  ].filter((value) => Number.isFinite(Number(value))).length
  const coreFundamentalTotal = 8
  const fundamentalsCoveragePct = Math.round((coreFundamentalCount / coreFundamentalTotal) * 100)

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close coin details"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 bg-[#02050d]/80 backdrop-blur-sm"
      />

      <div className="relative z-10 h-full overflow-y-auto">
        <div className="min-h-full px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            tabIndex={-1}
            className="mx-auto max-w-7xl overflow-hidden rounded-3xl border border-[#2a4167] bg-[linear-gradient(150deg,#081326_0%,#0d1f3f_45%,#091733_100%)] shadow-[0_40px_80px_rgba(2,6,17,0.72)]"
          >
            <div className="relative border-b border-[#274168] px-4 py-5 sm:px-6 sm:py-6">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(83,216,255,0.16),transparent_40%),radial-gradient(circle_at_10%_80%,rgba(255,190,46,0.12),transparent_35%)]" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <CoinIcon symbol={coin.symbol} name={coin.name} image={coin.image} imageCandidates={coin.image_candidates} />
                    <div className="min-w-0">
                      <p className="cc-mono text-[11px] uppercase tracking-[0.2em] text-[#8eacd6]">Asset Intelligence Room</p>
                      <h2 id={dialogTitleId} className="mt-1 text-2xl sm:text-3xl font-black text-white truncate">{coin.name}</h2>
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
                    <span className="rounded-full border border-[#356185] bg-[#132742] px-3 py-1 text-[11px] text-[#b9d6ff] cc-mono">
                      Data {coreFundamentalCount}/{coreFundamentalTotal}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onPrevCoin}
                      disabled={!hasPrevCoin}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                        hasPrevCoin
                          ? 'border-[#3d5f8f] bg-[#122540] text-[#d5e5ff] hover:border-[#6289bd]'
                          : 'border-[#294363] bg-[#101d32] text-[#708bb1] cursor-not-allowed'
                      }`}
                    >
                      {hasPrevCoin ? `Prev ${prevCoinSymbol || ''}` : 'Prev'}
                    </button>
                    <button
                      type="button"
                      onClick={onNextCoin}
                      disabled={!hasNextCoin}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                        hasNextCoin
                          ? 'border-[#3d5f8f] bg-[#122540] text-[#d5e5ff] hover:border-[#6289bd]'
                          : 'border-[#294363] bg-[#101d32] text-[#708bb1] cursor-not-allowed'
                      }`}
                    >
                      {hasNextCoin ? `Next ${nextCoinSymbol || ''}` : 'Next'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {binanceTradeUrl && (
                      <a
                        href={binanceTradeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-[#2f6e58] bg-[#123327] px-3 py-1.5 text-xs font-semibold text-[#89f2c9] hover:border-[#4ba27f]"
                      >
                        Open Binance
                      </a>
                    )}
                    {tradingViewUrl && (
                      <a
                        href={tradingViewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-[#44639a] bg-[#13284a] px-3 py-1.5 text-xs font-semibold text-[#d5e4ff] hover:border-[#7094cf]"
                      >
                        Open TradingView
                      </a>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    data-dialog-initial-focus="true"
                    className="rounded-lg border border-[#35527f] bg-[#13243f] px-3 py-2 text-sm font-semibold text-[#c6d8f6] hover:border-[#5578ad]"
                  >
                    Close
                  </button>
                </div>
              </div>

              <p className="relative mt-2 text-[11px] text-[#8ea8d1]">
                Quick keys: <span className="text-white">Left/Right</span> to switch coin, <span className="text-white">Esc</span> to close layer.
              </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 p-4 sm:p-6">
              <div className="xl:col-span-8 space-y-4">
                <div className="rounded-2xl border border-[#2c446d] bg-[linear-gradient(145deg,#0d1a31,#0f2341)] p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-white">Market Structure</p>
                      <p className="text-xs text-[#95acd2] mt-1">Range behavior, intraday trend and execution map</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-[#345985] bg-[#132744] px-2 py-1 text-[11px] cc-mono text-[#cfe0ff]">
                          Now {formatPrice(displayChartPrice, Math.abs(Number(displayChartPrice) || 0) >= 1 ? 2 : 6)}
                        </span>
                        {chartChangePct != null && (
                          <span className={`rounded-md border px-2 py-1 text-[11px] cc-mono ${chartChangePct >= 0 ? 'border-[#2f6e58] bg-[#133428] text-[#89f2c9]' : 'border-[#713345] bg-[#3a202c] text-[#ffb3c3]'}`}>
                            Interval {formatSignedPercent(chartChangePct)}
                          </span>
                        )}
                        <span className="rounded-md border border-[#2f4a72] bg-[#111f39] px-2 py-1 text-[11px] cc-mono text-[#9db6dd]">
                          {chartPriceModeLabel} chart
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
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
                      <div className="inline-flex p-1 rounded-lg bg-[#111f39] border border-[#2d456f]">
                        {CHART_VIEWS.map((view) => (
                          <button
                            key={view.value}
                            type="button"
                            onClick={() => setChartView(view.value)}
                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${chartView === view.value
                              ? 'bg-[#2a77ff] text-[#eef5ff]'
                              : 'text-[#a9bfdf] hover:text-white'
                            }`}
                          >
                            {view.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setChartFullscreen(true)}
                        className="rounded-lg border border-[#395b89] bg-[#12233f] px-3 py-2 text-xs font-semibold text-[#cfe0fd] hover:border-[#5f86bd]"
                      >
                        Fullscreen
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    {chartLoading ? (
                      <div className="h-56 rounded-2xl border border-[#2b4268] bg-[#0b172e] flex items-center justify-center">
                        <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-[#f0b90b]" />
                      </div>
                    ) : (
                      <DetailChart
                        points={chartPointsToRender}
                        mode={chartView}
                        expanded={false}
                        chartIdPrefix="detail-inline"
                      />
                    )}
                  </div>

                  {chartError && !usingFallbackChart && (
                    <p className="mt-3 text-sm text-[#ff9db0]">{chartError}</p>
                  )}
                  {usingFallbackChart && (
                    <p className="mt-3 text-xs text-[#9cb5dc]">
                      Live chart unavailable for this interval. Showing cached 7d sparkline projection.
                    </p>
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
                  <div className="mt-3 h-2 rounded-full border border-[#2e4b73] bg-[#13233f] overflow-hidden">
                    <div
                      className="h-full bg-[linear-gradient(90deg,#5fd5ff,#ffbe2e)]"
                      style={{ width: `${fundamentalsCoveragePct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[#90aad4]">
                    Fundamentals coverage {fundamentalsCoveragePct}% ({coreFundamentalCount}/{coreFundamentalTotal}) | Updated {formatDateTime(chartUpdatedAt)}
                  </p>
                  <div className="mt-4 space-y-2 text-xs text-[#9fb6da]">
                    <p>Price now: <span className="font-semibold text-white">{formatPrice(coin.current_price, 6)}</span></p>
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
                  <p className="mt-1 text-xs text-[#90a5ca]">
                    Latest {coin.symbol?.toUpperCase()} context to validate trend strength | Feed: {newsSourceLabel}
                  </p>

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
                  <p className="cc-mono uppercase tracking-[0.14em] text-[10px] text-[#8ea8d3]">Data Snapshot</p>
                  <p>Pair: <span className="font-semibold text-white">{displayPair}</span></p>
                  <p>Interval: <span className="font-semibold text-white">{chartInterval}</span></p>
                  <p>Candles: <span className="font-semibold text-white">{chartPointsToRender.length || 0}</span></p>
                  <p>Total Supply: <span className="font-semibold text-white">{formatSupply(coin.total_supply)}</span></p>
                  <p>Max Supply: <span className="font-semibold text-white">{formatSupply(coin.max_supply)}</span></p>
                  <p>ATH: <span className="font-semibold text-white">{formatPrice(coin.ath)}</span></p>
                  <p>ATL: <span className="font-semibold text-white">{formatPrice(coin.atl)}</span></p>
                  <p>Coin ID: <span className="font-semibold text-white">{coin.coingecko_id || 'N/A'}</span></p>
                </div>
              </aside>
            </div>
          </section>
        </div>
      </div>

      {chartFullscreen && (
        <div className="fixed inset-0 z-[70]">
          <button
            type="button"
            aria-label="Close fullscreen chart"
            onClick={() => setChartFullscreen(false)}
            className="absolute inset-0 bg-[#01040c]/90 backdrop-blur-md"
          />
          <div className="relative z-10 h-full p-3 sm:p-5 lg:p-8">
            <section className="mx-auto flex h-full w-full max-w-[1460px] flex-col overflow-hidden rounded-3xl border border-[#35537c] bg-[linear-gradient(150deg,#08162b_0%,#0f2748_46%,#091a36_100%)] shadow-[0_45px_100px_rgba(1,4,12,0.8)]">
              <div className="flex items-center justify-between gap-3 border-b border-[#2f4b72] px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="cc-mono text-[11px] uppercase tracking-[0.16em] text-[#91abd4]">Expanded Chart View</p>
                  <p className="text-sm text-[#d5e3fb] truncate">
                    {displayPair} | {chartInterval} | {chartView === 'candles' ? 'Candles' : 'Line'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setChartFullscreen(false)}
                  className="rounded-lg border border-[#416798] bg-[#122845] px-3 py-2 text-sm font-semibold text-[#d6e6ff] hover:border-[#6f95c7]"
                >
                  Close Fullscreen
                </button>
              </div>

              <div className="flex-1 p-3 sm:p-5">
                {chartLoading ? (
                  <div className="h-full rounded-2xl border border-[#2b4268] bg-[#0b172e] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#f0b90b]" />
                  </div>
                ) : (
                  <DetailChart
                    points={chartPointsToRender}
                    mode={chartView}
                    expanded
                    chartIdPrefix="detail-fullscreen"
                  />
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

const Market = ({ market, loading, qualityBySymbol = {}, qualityApiFailed = false }) => {
  const [visibleStep, setVisibleStep] = useState(1)
  const [selectedCoinKey, setSelectedCoinKey] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [marketPreset, setMarketPreset] = useState('balanced')
  const [sourceFilter, setSourceFilter] = useState('all')
  const activePreset = MARKET_PRESETS[marketPreset] || MARKET_PRESETS.balanced
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
  const quickMarketStats = useMemo(() => {
    const valid = filteredMarket.filter((coin) => Number.isFinite(Number(coin.price_change_percentage_24h)))
    if (valid.length === 0) {
      return {
        gainers: 0,
        losers: 0,
        averageMove: null,
        totalVolume: null,
        topGainer: null,
        topLoser: null,
      }
    }

    let gainers = 0
    let losers = 0
    let totalMove = 0
    let totalVolume = 0
    let topGainer = null
    let topLoser = null

    valid.forEach((coin) => {
      const change = Number(coin.price_change_percentage_24h)
      const volume = Number(coin.total_volume)

      totalMove += change
      if (Number.isFinite(volume) && volume > 0) totalVolume += volume
      if (change > 0) gainers += 1
      if (change < 0) losers += 1

      if (!topGainer || change > Number(topGainer.price_change_percentage_24h)) {
        topGainer = coin
      }
      if (!topLoser || change < Number(topLoser.price_change_percentage_24h)) {
        topLoser = coin
      }
    })

    return {
      gainers,
      losers,
      averageMove: totalMove / valid.length,
      totalVolume: totalVolume > 0 ? totalVolume : null,
      topGainer,
      topLoser,
    }
  }, [filteredMarket])
  const snapshotLabel = new Date().toLocaleTimeString()
  const hasActiveFilters = marketPreset !== 'balanced'
    || effectiveSourceFilter !== 'all'
    || searchQuery.trim().length > 0

  const visibleCount = useMemo(() => {
    if (sortedMarket.length === 0) return 0
    const targetCount = Math.max(MARKET_RENDER_CHUNK, visibleStep * MARKET_RENDER_CHUNK)
    return Math.min(sortedMarket.length, targetCount)
  }, [sortedMarket.length, visibleStep])
  const visibleMarket = useMemo(() => sortedMarket.slice(0, visibleCount), [sortedMarket, visibleCount])
  const hasMoreCoins = visibleCount < sortedMarket.length
  const browseProgress = sortedMarket.length > 0
    ? Math.min(100, (visibleMarket.length / sortedMarket.length) * 100)
    : 0

  const selectedCoin = useMemo(() => {
    if (!selectedCoinKey) return null
    return sortedMarket.find((coin) => (coin.id || coin.symbol) === selectedCoinKey)
      || market.find((coin) => (coin.id || coin.symbol) === selectedCoinKey)
      || null
  }, [market, selectedCoinKey, sortedMarket])
  const selectedCoinIndex = useMemo(() => {
    if (!selectedCoinKey) return -1
    return sortedMarket.findIndex((coin) => (coin.id || coin.symbol) === selectedCoinKey)
  }, [selectedCoinKey, sortedMarket])
  const hasPrevCoin = selectedCoinIndex > 0
  const hasNextCoin = selectedCoinIndex >= 0 && selectedCoinIndex < (sortedMarket.length - 1)
  const prevCoinSymbol = hasPrevCoin ? sortedMarket[selectedCoinIndex - 1]?.symbol?.toUpperCase() : ''
  const nextCoinSymbol = hasNextCoin ? sortedMarket[selectedCoinIndex + 1]?.symbol?.toUpperCase() : ''

  const selectedQuality = useMemo(() => {
    if (!selectedCoin?.symbol) return null
    const pair = `${selectedCoin.symbol.toUpperCase()}USDT`
    return qualityBySymbol?.[pair] || null
  }, [selectedCoin, qualityBySymbol])

  const handleCoinSelect = (coin) => {
    setSelectedCoinKey(coin.id || coin.symbol || null)
  }
  const handlePrevCoinSelect = () => {
    if (!hasPrevCoin) return
    const previousCoin = sortedMarket[selectedCoinIndex - 1]
    setSelectedCoinKey(previousCoin?.id || previousCoin?.symbol || null)
  }
  const handleNextCoinSelect = () => {
    if (!hasNextCoin) return
    const nextCoin = sortedMarket[selectedCoinIndex + 1]
    setSelectedCoinKey(nextCoin?.id || nextCoin?.symbol || null)
  }

  const handleResetFilters = () => {
    setSearchQuery('')
    setSourceFilter('all')
    setMarketPreset('balanced')
    setVisibleStep(1)
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
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setVisibleStep(1)
              }}
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
              onChange={(event) => {
                setSourceFilter(event.target.value)
                setVisibleStep(1)
              }}
              className="w-full rounded-xl border border-[#40608f] bg-[#0b162a] px-3 py-3 text-sm text-[#dce8fb] outline-none focus:border-[#ffbe2e]"
            >
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full lg:w-auto">
            <button
              type="button"
              onClick={handleResetFilters}
              disabled={!hasActiveFilters}
              className={`w-full lg:w-auto rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
                hasActiveFilters
                  ? 'border-[#5d7fae] bg-[#12243f] text-[#d7e7ff] hover:border-[#7ea2d0]'
                  : 'border-[#2c4467] bg-[#101b31] text-[#6c87af] cursor-not-allowed'
              }`}
            >
              Reset Filters
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {Object.entries(MARKET_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMarketPreset(key)
                setVisibleStep(1)
              }}
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

        {hasActiveFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="cc-mono rounded-full border border-[#3a5d8a] bg-[#132744] px-2.5 py-1 text-[#b9d2f6]">
              Preset: {activePreset.label}
            </span>
            {effectiveSourceFilter !== 'all' && (
              <span className="cc-mono rounded-full border border-[#3a5d8a] bg-[#132744] px-2.5 py-1 text-[#b9d2f6]">
                Source: {sourceOptions.find((option) => option.value === effectiveSourceFilter)?.label}
              </span>
            )}
            {searchQuery.trim() && (
              <span className="cc-mono rounded-full border border-[#3a5d8a] bg-[#132744] px-2.5 py-1 text-[#b9d2f6]">
                Query: "{searchQuery.trim()}"
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-[#314f76] bg-[linear-gradient(150deg,#0d1f38,#102540)] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#8fb0dc]">Breadth</p>
          <p className="mt-1 text-sm text-white font-semibold">
            {quickMarketStats.gainers} Gainers / {quickMarketStats.losers} Losers
          </p>
          <p className="mt-1 text-xs text-[#9fb7dc]">
            Volume {formatCompactUsd(quickMarketStats.totalVolume)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#314f76] bg-[linear-gradient(150deg,#0d1f38,#102540)] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#8fb0dc]">Average 24h Move</p>
          <p className="mt-1 text-sm text-white font-semibold">{formatSignedPercent(quickMarketStats.averageMove)}</p>
        </div>
        <button
          type="button"
          onClick={() => quickMarketStats.topGainer && handleCoinSelect(quickMarketStats.topGainer)}
          disabled={!quickMarketStats.topGainer}
          className={`text-left rounded-2xl border p-3 transition-colors ${
            quickMarketStats.topGainer
              ? 'border-[#2f6f57] bg-[linear-gradient(150deg,#112d24,#143428)] hover:border-[#4b9778]'
              : 'border-[#314f76] bg-[linear-gradient(150deg,#0d1f38,#102540)]'
          }`}
        >
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#8fb0dc]">Top Gainer</p>
          <p className="mt-1 text-sm text-white font-semibold">
            {quickMarketStats.topGainer ? `${quickMarketStats.topGainer.symbol?.toUpperCase()} ${formatSignedPercent(Number(quickMarketStats.topGainer.price_change_percentage_24h))}` : 'N/A'}
          </p>
        </button>
        <button
          type="button"
          onClick={() => quickMarketStats.topLoser && handleCoinSelect(quickMarketStats.topLoser)}
          disabled={!quickMarketStats.topLoser}
          className={`text-left rounded-2xl border p-3 transition-colors ${
            quickMarketStats.topLoser
              ? 'border-[#6f3345] bg-[linear-gradient(150deg,#2d1620,#371a28)] hover:border-[#9c4a62]'
              : 'border-[#314f76] bg-[linear-gradient(150deg,#0d1f38,#102540)]'
          }`}
        >
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#8fb0dc]">Top Loser</p>
          <p className="mt-1 text-sm text-white font-semibold">
            {quickMarketStats.topLoser ? `${quickMarketStats.topLoser.symbol?.toUpperCase()} ${formatSignedPercent(Number(quickMarketStats.topLoser.price_change_percentage_24h))}` : 'N/A'}
          </p>
        </button>
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
                    onClick={() => setVisibleStep((current) => current + 1)}
                    className="rounded-xl border border-[#3d5d89] bg-[#122643] px-4 py-2 text-sm font-semibold text-[#dce9ff] hover:border-[#638bbb]"
                  >
                    Load Next {Math.min(MARKET_RENDER_CHUNK, sortedMarket.length - visibleCount)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleStep(Math.ceil(sortedMarket.length / MARKET_RENDER_CHUNK))}
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
            Auto-refresh active | Snapshot {snapshotLabel}
          </p>
        </div>
      </div>

      {selectedCoin && (
        <CoinDetailOverlay
          coin={selectedCoin}
          quality={selectedQuality}
          qualityApiFailed={qualityApiFailed}
          onPrevCoin={handlePrevCoinSelect}
          onNextCoin={handleNextCoinSelect}
          hasPrevCoin={hasPrevCoin}
          hasNextCoin={hasNextCoin}
          prevCoinSymbol={prevCoinSymbol}
          nextCoinSymbol={nextCoinSymbol}
          onClose={() => setSelectedCoinKey(null)}
        />
      )}
    </div>
  )
}

export default Market

