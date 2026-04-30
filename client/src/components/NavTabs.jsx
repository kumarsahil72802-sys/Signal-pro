import React from 'react';

const NavTabs = ({ activeTab, setActiveTab, signalCount, hasNewSignal, onSignalsClick }) => {
  const tabs = [
    { id: 'market', label: 'Market', icon: '📊' },
    { id: 'news', label: 'News', icon: '📰' },
    { id: 'signals', label: 'Signals', icon: '📡', showBadge: true },
    { id: 'stats', label: 'Stats', icon: '📈' }
  ];

  const handleClick = (tabId) => {
    if (tabId === 'signals' && onSignalsClick) {
      onSignalsClick();
    }
    setActiveTab(tabId);
  };

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-blue-600">Signal</span>
            <span className="text-gray-400 text-sm">Pro</span>
          </div>
          
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleClick(tab.id)}
                className={`
                  px-4 py-2 text-sm font-medium rounded-md transition-all duration-200
                  flex items-center gap-2 relative
                  ${activeTab === tab.id 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                  }
                  ${tab.id === 'signals' && hasNewSignal && activeTab !== 'signals'
                    ? 'animate-pulse bg-red-100 text-red-600 ring-2 ring-red-400 ring-opacity-50' 
                    : ''
                  }
                `}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.showBadge && signalCount > 0 && (
                  <span className={`
                    ml-1 px-1.5 py-0.5 text-xs font-bold rounded-full
                    ${activeTab === 'signals' 
                      ? 'bg-blue-100 text-blue-700' 
                      : hasNewSignal 
                        ? 'bg-red-500 text-white' 
                        : 'bg-gray-500 text-white'
                    }
                  `}>
                    {signalCount}
                  </span>
                )}
                {tab.id === 'signals' && hasNewSignal && activeTab !== 'signals' && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default NavTabs;
