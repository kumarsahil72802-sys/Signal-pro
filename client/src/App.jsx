import { useState, useEffect, useRef } from 'react'
import { getSignals, takeSignal, missSignal, getMarketData, getNews } from './services/api'
import { NavTabs, Market, News, Signals, Stats, Toast } from './components'

function App() {
  const [activeTab, setActiveTab] = useState('market')
  
  const [signals, setSignals] = useState([])
  const [signalsLoading, setSignalsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  
  const [market, setMarket] = useState([])
  const [marketLoading, setMarketLoading] = useState(true)
  
  const [news, setNews] = useState([])
  const [newsLoading, setNewsLoading] = useState(true)

  const [toast, setToast] = useState(null)
  const [hasNewSignal, setHasNewSignal] = useState(false)
  
  const prevSignalCount = useRef(0)
  const initialLoadDone = useRef(false)
  
  const [initialLoading, setInitialLoading] = useState(true)

  const activeSignalCount = signals.filter(s => s.status !== 'CLOSED').length

  const fetchSignals = () => {
    getSignals()
      .then((res) => {
        const newSignals = res.data
        const newActiveCount = newSignals.filter(s => s.status !== 'CLOSED').length
        
        if (initialLoadDone.current && newActiveCount > prevSignalCount.current) {
          const diff = newActiveCount - prevSignalCount.current
          setHasNewSignal(true)
          setToast({
            message: `New Signal${diff > 1 ? 's' : ''} Available 🚀`,
            type: 'signal'
          })
        }
        
        prevSignalCount.current = newActiveCount
        initialLoadDone.current = true
        setSignals(newSignals)
      })
      .catch((err) => console.error('Failed to fetch signals:', err))
      .finally(() => setSignalsLoading(false))
  }

  const fetchMarket = () => {
    getMarketData()
      .then((res) => setMarket(res.data))
      .catch((err) => console.error('Failed to fetch market data:', err))
      .finally(() => {
        setMarketLoading(false)
        setInitialLoading(false)
      })
  }

  const fetchNews = () => {
    getNews()
      .then((res) => setNews(res.data))
      .catch((err) => console.error('Failed to fetch news:', err))
      .finally(() => {
        setNewsLoading(false)
        setInitialLoading(false)
      })
  }

  const fetchAll = () => {
    fetchSignals()
    fetchMarket()
    fetchNews()
  }

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!signalsLoading && !marketLoading && !newsLoading) {
      setInitialLoading(false)
    }
  }, [signalsLoading, marketLoading, newsLoading])

  const handleTake = async (id) => {
    setActionLoading(id)
    try {
      await takeSignal(id)
      fetchSignals()
    } catch (err) {
      console.error('Failed to take signal:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const handleMiss = async (id) => {
    setActionLoading(id)
    try {
      await missSignal(id)
      fetchSignals()
    } catch (err) {
      console.error('Failed to miss signal:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const handleSignalsClick = () => {
    setHasNewSignal(false)
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'market':
        return <Market market={market} loading={marketLoading || initialLoading} />
      case 'news':
        return <News news={news} loading={newsLoading || initialLoading} />
      case 'signals':
        return (
          <Signals 
            signals={signals} 
            loading={signalsLoading || initialLoading}
            actionLoading={actionLoading}
            onTake={handleTake}
            onMiss={handleMiss}
          />
        )
      case 'stats':
        return <Stats loading={initialLoading} />
      default:
        return <Market market={market} loading={marketLoading || initialLoading} />
    }
  }

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavTabs 
          activeTab={activeTab} 
          setActiveTab={setActiveTab}
          signalCount={0}
          hasNewSignal={false}
          onSignalsClick={handleSignalsClick}
        />
        <main className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-500">Loading data...</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
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
      
      <main className="max-w-4xl mx-auto px-6 py-8">
        {renderContent()}
      </main>
      
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <p className="text-center text-sm text-gray-500">
            Signal Pro • Auto-refreshing every 10 seconds
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
