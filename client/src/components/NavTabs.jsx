const NavTabs = ({ activeTab, setActiveTab, signalCount, hasNewSignal, onSignalsClick }) => {
  const tabs = [
    { id: 'market', label: 'Market Deck', hint: 'Live observatory', code: 'MK' },
    { id: 'news', label: 'News Pulse', hint: 'Narrative scanner', code: 'NW' },
    { id: 'signals', label: 'Signal Vault', hint: 'Execution calls', showBadge: true, code: 'SG' },
    { id: 'stats', label: 'Edge Report', hint: 'PnL analytics', code: 'ST' }
  ]

  const handleClick = (tabId) => {
    if (tabId === 'signals' && onSignalsClick) {
      onSignalsClick()
    }
    setActiveTab(tabId)
  }

  return (
    <nav className="sticky top-0 z-30 border-b border-[#2a3f60]/85 bg-[linear-gradient(180deg,rgba(6,13,24,0.95),rgba(7,15,29,0.88))] backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="min-h-[86px] py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="cc-brand-shell">
              <span className="cc-brand-ring cc-brand-ring-a" />
              <span className="cc-brand-ring cc-brand-ring-b" />
              <img
                src="/coinchakra.jpeg"
                alt="CoinChakra Logo"
                className="cc-brand-core"
                loading="eager"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[18px] sm:text-[21px] font-extrabold tracking-tight text-white">CoinChakra</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#9cb6dc]">Signal Command Grid</p>
                <span className="cc-mono inline-flex items-center gap-1 rounded-full border border-[#355276] bg-[#13253f] px-2 py-0.5 text-[10px] text-[#7ce6bb]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#33d59f] cc-ridge" />
                  LIVE
                </span>
              </div>
            </div>
          </div>

          <div className="relative flex gap-1.5 p-1.5 rounded-2xl bg-[#101f35]/90 border border-[#2d476e] overflow-x-auto cc-noise">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleClick(tab.id)}
                className={`
                  px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-200
                  flex items-center gap-2 relative whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'bg-[linear-gradient(145deg,#203756,#1a2f4b)] text-[#ffbe2e] border border-[#ffbe2e]/45 shadow-[0_10px_26px_rgba(255,190,46,0.16)]'
                    : 'text-[#99b2d9] border border-transparent hover:text-white hover:border-[#355172] hover:bg-[#192d49]'
                  }
                  ${tab.id === 'signals' && hasNewSignal && activeTab !== 'signals'
                    ? 'animate-pulse ring-2 ring-[#ff6f8d]/50'
                    : ''
                  }
                `}
              >
                <span className={`cc-mono hidden sm:inline-flex h-5 min-w-[22px] items-center justify-center rounded-md border px-1 text-[10px] ${
                  activeTab === tab.id
                    ? 'border-[#755c22] bg-[#35290f] text-[#ffd782]'
                    : 'border-[#3b5478] bg-[#142640] text-[#93aed8]'
                }`}>
                  {tab.code}
                </span>
                <span className="flex flex-col items-start leading-tight">
                  <span>{tab.label}</span>
                  <span className="text-[10px] text-[#7f99c4]">{tab.hint}</span>
                </span>
                {tab.showBadge && signalCount > 0 && (
                  <span className={`
                    ml-1 px-1.5 py-0.5 text-xs font-bold rounded-full
                    ${activeTab === 'signals'
                      ? 'bg-[#ffbe2e]/20 text-[#ffbe2e]'
                      : hasNewSignal
                        ? 'bg-[#ff6f8d] text-white'
                        : 'bg-[#2a4468] text-[#d4def1]'
                    }
                  `}>
                    {signalCount}
                  </span>
                )}
                {tab.id === 'signals' && hasNewSignal && activeTab !== 'signals' && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff6f8d] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#ff6f8d]"></span>
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
