import { useState, useEffect, useRef } from 'react'
import { getSignals, takeSignal, getMarketData, getMarketQuality, getNews, login, getAuthMe, setAuthToken, clearAuthToken, getAuthToken } from './services/api'
import { NavTabs, Market, News, Signals, Stats, Toast, AuthPanel } from './components'

const CORE_REFRESH_MS = 12000
const NEWS_REFRESH_MS = 30000
const QUALITY_DEBOUNCE_MS = 250
const QUALITY_MIN_GAP_MS = 10000
const MARKET_CACHE_KEY = 'signal.market.snapshot.v2'
const MARKET_FETCH_LIMIT = 140
const MAX_QUALITY_MARKET_SYMBOLS = 50
const EXCLUDED_QUALITY_BASES = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'PYUSD'])
const EXCLUDED_MARKET_BASES = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'USDE', 'USD1', 'PYUSD'])

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase()
}

function sanitizeMarketData(rawData = []) {
  if (!Array.isArray(rawData)) return []

  return rawData.filter((coin) => {
    const symbol = normalizeSymbol(coin?.symbol)
    if (!symbol || EXCLUDED_MARKET_BASES.has(symbol)) return false

    const source = String(coin?.source || '').trim().toLowerCase()
    if (source !== 'binance') return false

    const price = Number(coin?.current_price)
    if (!Number.isFinite(price) || price <= 0) return false

    return true
  })
}

function isEligibleQualitySymbol(symbol) {
  if (!/^[A-Z0-9]+USDT$/.test(symbol)) return false
  const base = symbol.slice(0, -4)
  return base.length > 0 && !EXCLUDED_QUALITY_BASES.has(base)
}

function buildQualitySymbols(marketData = [], signalData = []) {
  const marketSymbols = marketData
    .slice(0, MAX_QUALITY_MARKET_SYMBOLS)
    .map((coin) => `${normalizeSymbol(coin.symbol)}USDT`)
    .filter(isEligibleQualitySymbol)

  const signalSymbols = signalData
    .map((signal) => normalizeSymbol(signal.coin))
    .filter(isEligibleQualitySymbol)

  return [...new Set([...marketSymbols, ...signalSymbols])]
}

function loadCachedMarket() {
  try {
    const raw = localStorage.getItem(MARKET_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return sanitizeMarketData(parsed)
  } catch {
    return []
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('market')
  const [signals, setSignals] = useState([])
  const [signalsLoading, setSignalsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  const [market, setMarket] = useState(() => loadCachedMarket())
  const [marketLoading, setMarketLoading] = useState(() => loadCachedMarket().length === 0)
  const [news, setNews] = useState([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [qualityBySymbol, setQualityBySymbol] = useState({})
  const [qualityApiFailed, setQualityApiFailed] = useState(false)
  const [toast, setToast] = useState(null)
  const [hasNewSignal, setHasNewSignal] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authChecking, setAuthChecking] = useState(true)

  const prevSignalCount = useRef(0)
  const initialLoadDone = useRef(false)
  const signalsRef = useRef([])
  const marketRef = useRef([])
  const qualityTimerRef = useRef(null)
  const qualityInFlightRef = useRef(false)
  const qualityPendingRef = useRef(false)
  const lastQualityRequestAtRef = useRef(0)
  const lastQualityKeyRef = useRef('')
  const coreInFlightRef = useRef(false)
  const newsInFlightRef = useRef(false)
  const coreLoopTimerRef = useRef(null)
  const newsLoopTimerRef = useRef(null)

  const activeSignalCount = signals.filter((s) => s.status !== 'CLOSED').length
  const isAuthenticated = Boolean(authUser)

  const restoreSession = async () => {
    const existingToken = getAuthToken()
    if (!existingToken) return null

    try {
      const response = await getAuthMe()
      const user = response.data?.user || null
      setAuthUser(user)
      setAuthError('')
      return user
    } catch {
      clearAuthToken()
      setAuthUser(null)
      setAuthError('Session expired. Please login again.')
      return null
    }
  }

  const handleLogin = async (email, password) => {
    setAuthLoading(true)
    setAuthError('')
    try {
      const response = await login(email, password)
      const token = String(response.data?.token || '').trim()
      if (!token) {
        throw new Error('Invalid login response')
      }
      setAuthToken(token)
      const user = response.data?.user || null
      setAuthUser(user)
      setToast({ message: 'Login successful', type: 'success' })
      await Promise.all([fetchSignals(), fetchMarket(), fetchNewsFeed()])
      requestQuality(true)
      return user
    } catch (error) {
      const message = error?.response?.data?.message || 'Login failed. Please check email/password.'
      setAuthError(message)
      return null
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    clearAuthToken()
    setAuthUser(null)
    setAuthError('')
    setToast({ message: 'Logged out', type: 'info' })
  }

  const applySignalState = (newSignals) => {
    const safeSignals = Array.isArray(newSignals) ? newSignals : []
    const newActiveCount = safeSignals.filter((s) => s.status !== 'CLOSED').length

    if (initialLoadDone.current && newActiveCount > prevSignalCount.current) {
      const diff = newActiveCount - prevSignalCount.current
      setHasNewSignal(true)
      setToast({
        message: `New Signal${diff > 1 ? 's' : ''} Available`,
        type: 'signal'
      })
    }

    prevSignalCount.current = newActiveCount
    initialLoadDone.current = true
    signalsRef.current = safeSignals
    setSignals(safeSignals)
  }

  const requestQuality = async (force = false) => {
    const symbols = buildQualitySymbols(marketRef.current, signalsRef.current)
    const sortedSymbols = symbols.slice().sort()
    const symbolKey = sortedSymbols.join(',')

    if (!force && symbolKey.length === 0) {
      setQualityBySymbol({})
      setQualityApiFailed(false)
      return
    }

    const now = Date.now()
    if (!force && symbolKey === lastQualityKeyRef.current && (now - lastQualityRequestAtRef.current) < QUALITY_MIN_GAP_MS) {
      return
    }

    if (qualityInFlightRef.current) {
      qualityPendingRef.current = true
      return
    }

    qualityInFlightRef.current = true
    try {
      const response = await getMarketQuality(sortedSymbols)
      setQualityBySymbol(response.data?.data || {})
      setQualityApiFailed(false)
      lastQualityKeyRef.current = symbolKey
      lastQualityRequestAtRef.current = Date.now()
    } catch (error) {
      console.error('Failed to fetch market quality:', error)
      setQualityBySymbol({})
      setQualityApiFailed(true)
    } finally {
      qualityInFlightRef.current = false
      if (qualityPendingRef.current) {
        qualityPendingRef.current = false
        setTimeout(() => {
          requestQuality(false)
        }, 0)
      }
    }
  }

  const scheduleQualityRefresh = () => {
    if (qualityTimerRef.current) {
      clearTimeout(qualityTimerRef.current)
    }

    qualityTimerRef.current = setTimeout(() => {
      requestQuality(false)
    }, QUALITY_DEBOUNCE_MS)
  }

  const fetchSignals = async () => {
    try {
      const res = await getSignals()
      applySignalState(res.data || [])
      scheduleQualityRefresh()
    } catch (err) {
      console.error('Failed to fetch signals:', err)
    } finally {
      setSignalsLoading(false)
    }
  }

  const fetchMarket = async () => {
    try {
      const res = await getMarketData(MARKET_FETCH_LIMIT)
      const marketData = sanitizeMarketData(res.data || [])
      marketRef.current = marketData
      setMarket(marketData)
      localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(marketData))
      scheduleQualityRefresh()
    } catch (err) {
      console.error('Failed to fetch market data:', err)
    } finally {
      setMarketLoading(false)
    }
  }

  const fetchNewsFeed = async () => {
    try {
      const res = await getNews()
      setNews(res.data || [])
    } catch (err) {
      console.error('Failed to fetch news:', err)
    } finally {
      setNewsLoading(false)
    }
  }

  useEffect(() => {
    marketRef.current = market

    const initialTimer = setTimeout(() => {
      ;(async () => {
        const user = await restoreSession()
        if (user) {
          await Promise.all([fetchSignals(), fetchMarket(), fetchNewsFeed()])
        }
        setAuthChecking(false)
      })()
    }, 0)

    const runCoreLoop = async () => {
      if (!coreInFlightRef.current && isAuthenticated) {
        coreInFlightRef.current = true
        try {
          await Promise.all([fetchSignals(), fetchMarket()])
        } finally {
          coreInFlightRef.current = false
        }
      }

      coreLoopTimerRef.current = setTimeout(runCoreLoop, CORE_REFRESH_MS)
    }

    const runNewsLoop = async () => {
      if (!newsInFlightRef.current && isAuthenticated) {
        newsInFlightRef.current = true
        try {
          await fetchNewsFeed()
        } finally {
          newsInFlightRef.current = false
        }
      }

      newsLoopTimerRef.current = setTimeout(runNewsLoop, NEWS_REFRESH_MS)
    }

    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        if (isAuthenticated) {
          fetchSignals()
          fetchMarket()
        }
      }
    }

    coreLoopTimerRef.current = setTimeout(runCoreLoop, CORE_REFRESH_MS)
    newsLoopTimerRef.current = setTimeout(runNewsLoop, NEWS_REFRESH_MS)
    document.addEventListener('visibilitychange', visibilityHandler)

    return () => {
      clearTimeout(initialTimer)
      if (coreLoopTimerRef.current) clearTimeout(coreLoopTimerRef.current)
      if (newsLoopTimerRef.current) clearTimeout(newsLoopTimerRef.current)
      if (qualityTimerRef.current) clearTimeout(qualityTimerRef.current)
      document.removeEventListener('visibilitychange', visibilityHandler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  const handleTake = async (id) => {
    if (!isAuthenticated) {
      setToast({ message: 'Please login to take trades.', type: 'warning' })
      setActiveTab('signals')
      return
    }

    setActionLoading(id)
    try {
      await takeSignal(id)
      await fetchSignals()
      requestQuality(true)
    } catch (err) {
      console.error('Failed to take signal:', err)
      if (err?.response?.status === 401) {
        clearAuthToken()
        setAuthUser(null)
        setAuthError('Session expired. Please login again.')
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleSignalsClick = () => {
    setHasNewSignal(false)
  }

  const handleRequireAuth = () => {
    setAuthError('Please login to perform write actions.')
    setToast({ message: 'Login required for trade actions.', type: 'warning' })
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'market':
        return (
          <Market
            market={market}
            loading={marketLoading}
            qualityBySymbol={qualityBySymbol}
            qualityApiFailed={qualityApiFailed}
          />
        )
      case 'news':
        return <News news={news} loading={newsLoading} />
      case 'signals':
        return (
          <Signals
            signals={signals}
            loading={signalsLoading}
            actionLoading={actionLoading}
            onTake={handleTake}
            qualityBySymbol={qualityBySymbol}
            qualityApiFailed={qualityApiFailed}
            canTrade={isAuthenticated}
            onRequireAuth={handleRequireAuth}
          />
        )
      case 'stats':
        return <Stats loading={signalsLoading} />
      default:
        return (
          <Market
            market={market}
            loading={marketLoading}
            qualityBySymbol={qualityBySymbol}
            qualityApiFailed={qualityApiFailed}
          />
        )
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen text-[#d7e1f3] relative overflow-hidden flex items-center justify-center">
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{
          backgroundImage: 'linear-gradient(rgba(125,169,230,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(125,169,230,0.14) 1px, transparent 1px)',
          backgroundSize: '48px 48px'
        }} />
        <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-[#ffbe2e]/20 blur-[120px]" />
        <div className="pointer-events-none absolute right-0 top-10 h-96 w-96 rounded-full bg-[#5fd5ff]/16 blur-[130px]" />
        <div className="pointer-events-none absolute -bottom-16 left-1/3 h-80 w-80 rounded-full bg-[#234a86]/24 blur-[150px]" />
        <div className="relative flex items-center gap-3 rounded-2xl border border-[#2a466d] bg-[#101b2e]/90 px-6 py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#f0b90b]"></div>
          <p className="text-sm text-[#c6d7f4]">Checking secure session...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen text-[#d7e1f3] relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{
          backgroundImage: 'linear-gradient(rgba(125,169,230,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(125,169,230,0.14) 1px, transparent 1px)',
          backgroundSize: '48px 48px'
        }} />
        <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-[#ffbe2e]/20 blur-[120px]" />
        <div className="pointer-events-none absolute right-0 top-10 h-96 w-96 rounded-full bg-[#5fd5ff]/16 blur-[130px]" />
        <div className="pointer-events-none absolute -bottom-16 left-1/3 h-80 w-80 rounded-full bg-[#234a86]/24 blur-[150px]" />

        <div className="relative min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-xl">
            <div className="mb-5 text-center">
              <div className="cc-brand-shell mx-auto mb-3">
                <span className="cc-brand-ring cc-brand-ring-a" />
                <span className="cc-brand-ring cc-brand-ring-b" />
                <img
                  src="/coinchakra.jpeg"
                  alt="CoinChakra Logo"
                  className="cc-brand-core"
                  loading="eager"
                />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">CoinChakra Secure Access</h1>
              <p className="mt-2 text-sm text-[#9cb6dc]">Login required to enter the signal command grid.</p>
            </div>

            <AuthPanel
              authenticated={false}
              userEmail=""
              loading={authLoading}
              error={authError}
              onLogin={handleLogin}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen text-[#d7e1f3] relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{
        backgroundImage: 'linear-gradient(rgba(125,169,230,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(125,169,230,0.14) 1px, transparent 1px)',
        backgroundSize: '48px 48px'
      }} />
      <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-[#ffbe2e]/20 blur-[120px]" />
      <div className="pointer-events-none absolute right-0 top-10 h-96 w-96 rounded-full bg-[#5fd5ff]/16 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-16 left-1/3 h-80 w-80 rounded-full bg-[#234a86]/24 blur-[150px]" />

      <NavTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        signalCount={activeSignalCount}
        hasNewSignal={hasNewSignal}
        onSignalsClick={handleSignalsClick}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {renderContent()}
      </main>

      <footer className="relative border-t border-[#2b4267] bg-[linear-gradient(180deg,rgba(7,14,27,0.92),rgba(7,14,26,0.78))] mt-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex items-center justify-center gap-3">
            <div className="cc-brand-shell cc-brand-shell-sm">
              <span className="cc-brand-ring cc-brand-ring-a" />
              <img
                src="/coinchakra.jpeg"
                alt="CoinChakra"
                className="cc-brand-core"
                loading="lazy"
              />
            </div>
            <p className="text-center text-sm text-[#9ab3d9]">
              CoinChakra | Real-time signal observatory for fast conviction trading
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
