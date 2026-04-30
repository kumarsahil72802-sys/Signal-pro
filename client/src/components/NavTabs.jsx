const NavTabs = ({ activeTab, setActiveTab, signalCount, hasNewSignal, onSignalsClick }) => {
  const tabs = [
    { id: 'market', label: 'Market', icon: 'MKT' },
    { id: 'news', label: 'News', icon: 'NWS' },
    { id: 'signals', label: 'Signals', icon: 'SIG', showBadge: true },
    { id: 'stats', label: 'Stats', icon: 'P&L' }
  ]

  const handleClick = (tabId) => {
    if (tabId === 'signals' && onSignalsClick) {
      onSignalsClick()
    }
    setActiveTab(tabId)
  }

  return (
    <nav className="sticky top-0 z-20 border-b border-[#253149]/80 bg-[#0b1322]/90 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="min-h-[74px] py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/coinchakra.jpeg"
              alt="CoinChakra Logo"
              className="w-10 h-10 rounded-xl object-cover border border-[#3a4a67] shadow-[0_8px_20px_rgba(240,185,11,0.18)]"
              loading="eager"
            />
            <div>
              <p className="text-[17px] sm:text-[19px] font-extrabold tracking-tight text-white">CoinChakra</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#8fa3c4]">Mining Signal Desk</p>
            </div>
          </div>

          <div className="flex gap-1 p-1 rounded-xl bg-[#121d31] border border-[#26344d] overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleClick(tab.id)}
                className={`
                  px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-200
                  flex items-center gap-2 relative
                  ${activeTab === tab.id
                    ? 'bg-[#1a2940] text-[#f0b90b] border border-[#f0b90b]/40 shadow-[0_8px_22px_rgba(240,185,11,0.16)]'
                    : 'text-[#99accb] border border-transparent hover:text-white hover:border-[#2f3f5c] hover:bg-[#162238]'
                  }
                  ${tab.id === 'signals' && hasNewSignal && activeTab !== 'signals'
                    ? 'animate-pulse ring-2 ring-[#f6465d]/50'
                    : ''
                  }
                `}
              >
                <span className="text-[10px] sm:text-[11px] font-bold tracking-wide text-[#7f95ba]">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.showBadge && signalCount > 0 && (
                  <span className={`
                    ml-1 px-1.5 py-0.5 text-xs font-bold rounded-full
                    ${activeTab === 'signals'
                      ? 'bg-[#f0b90b]/20 text-[#f0b90b]'
                      : hasNewSignal
                        ? 'bg-[#f6465d] text-white'
                        : 'bg-[#2a3750] text-[#d4def1]'
                    }
                  `}>
                    {signalCount}
                  </span>
                )}
                {tab.id === 'signals' && hasNewSignal && activeTab !== 'signals' && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f6465d] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#f6465d]"></span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}

export default NavTabs
