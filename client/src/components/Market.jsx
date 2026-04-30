import { memo, useEffect, useMemo, useState } from 'react'

const MARKET_RENDER_CHUNK = 20

const CoinIcon = ({ symbol, name, image }) => {
  const [hasError, setHasError] = useState(false)
  const initial = symbol?.charAt(0)?.toUpperCase() || '?'

  if (!image || hasError) {
    return (
      <div className="w-10 h-10 rounded-full bg-[#1a2940] border border-[#31435f] flex items-center justify-center text-[#f0b90b] font-bold text-sm shadow-sm">
        {initial}
      </div>
    )
  }

  return (
    <img
      src={image}
      alt={name || symbol}
      className="w-10 h-10 rounded-full object-cover shadow-sm border border-[#31435f]"
      onError={() => setHasError(true)}
      loading="lazy"
    />
  )
}

const getExecutionBadgeClass = (quality) => {
  if (quality === 'GOOD') return 'bg-[#173427] text-[#64f2b3] border-[#2a6b4e]'
  if (quality === 'MODERATE') return 'bg-[#3a2d10] text-[#ffd56a] border-[#6b551f]'
  if (quality === 'RISKY') return 'bg-[#3b1b26] text-[#ff8fa1] border-[#6b3040]'
  return 'bg-[#1e2a3f] text-[#9cb1d3] border-[#30435f]'
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

const MarketCard = memo(function MarketCard({ coin, quality, qualityApiFailed }) {
  const isPositive = coin.price_change_percentage_24h >= 0
  const changeColor = isPositive ? 'text-[#64f2b3]' : 'text-[#ff8fa1]'
  const bgColor = isPositive ? 'bg-[#112b23]' : 'bg-[#341c25]'
  const executionQuality = (!qualityApiFailed && quality?.executionQuality) ? quality.executionQuality : 'N/A'
  const slippageRisk = (!qualityApiFailed && quality?.slippageRisk) ? quality.slippageRisk : 'N/A'
  const sparklinePrices = coin?.sparkline_in_7d?.price || []

  return (
    <div className="bg-[#111b2d]/95 border border-[#2a3a55] rounded-2xl p-4 hover:shadow-[0_18px_32px_rgba(5,8,15,0.46)] transition-all duration-200 hover:border-[#3c5174]">
      <div className="flex items-center gap-3 mb-3">
        <CoinIcon
          symbol={coin.symbol}
          name={coin.name}
          image={coin.image}
        />
        <div className="min-w-0">
          <p className="font-bold text-sm text-white truncate">{coin.symbol?.toUpperCase()}</p>
          <p className="text-xs text-[#8ea2c4] truncate">{coin.name}</p>
        </div>
      </div>

      <p className="text-xl font-bold text-white">
        ${coin.current_price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

      <div className="mt-3 pt-3 border-t border-[#26354f] space-y-1">
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
    </div>
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

const Market = ({ market, loading, qualityBySymbol = {}, qualityApiFailed = false }) => {
  const [visibleCount, setVisibleCount] = useState(MARKET_RENDER_CHUNK)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisibleCount(MARKET_RENDER_CHUNK)
    }, 0)

    return () => clearTimeout(timer)
  }, [market])

  useEffect(() => {
    if (visibleCount >= market.length) return undefined

    const timer = setTimeout(() => {
      setVisibleCount((current) => Math.min(current + MARKET_RENDER_CHUNK, market.length))
    }, 16)

    return () => clearTimeout(timer)
  }, [visibleCount, market.length])

  const visibleMarket = useMemo(() => market.slice(0, visibleCount), [market, visibleCount])

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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Market Overview</h2>
        <p className="text-[#8ea2c4] text-sm mt-1">Live crypto pricing with execution quality mapping</p>
        {qualityApiFailed && (
          <p className="text-xs text-[#ffd56a] mt-2">
            Execution quality data is temporarily unavailable. Showing fallback labels.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {visibleMarket.map((coin) => {
          const pair = `${coin.symbol?.toUpperCase()}USDT`
          const quality = qualityBySymbol?.[pair]

          return (
            <MarketCard
              key={coin.symbol || coin.id}
              coin={coin}
              quality={quality}
              qualityApiFailed={qualityApiFailed}
            />
          )
        })}
      </div>

      <div className="mt-8 p-4 bg-[#101a2c] rounded-xl border border-[#2b3b57]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#f0b90b] animate-pulse"></span>
          <p className="text-sm text-[#c4d2ea]">
            Auto-refresh active. Last updated: {new Date().toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  )
}

export default Market
