import React, { useState } from 'react';

const CoinIcon = ({ symbol, name, image }) => {
  const [hasError, setHasError] = useState(false);
  const initial = symbol?.charAt(0)?.toUpperCase() || '?';
  
  const colors = [
    'bg-orange-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 
    'bg-pink-500', 'bg-indigo-500', 'bg-red-500', 'bg-teal-500'
  ];
  const colorIndex = symbol?.charCodeAt(0) % colors.length || 0;
  const bgColor = colors[colorIndex];

  if (!image || hasError) {
    return (
      <div className={`w-10 h-10 rounded-full ${bgColor} flex items-center justify-center text-white font-bold text-sm shadow-sm`}>
        {initial}
      </div>
    );
  }

  return (
    <img 
      src={image} 
      alt={name || symbol}
      className="w-10 h-10 rounded-full object-cover shadow-sm"
      onError={() => setHasError(true)}
      loading="lazy"
    />
  );
};

const Market = ({ market, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (market.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-lg">No market data available</p>
        <p className="text-gray-400 text-sm mt-2">Check your connection and try again</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900">Market Overview</h2>
        <p className="text-gray-500 text-sm mt-1">Live cryptocurrency prices and 24h changes</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {market.map((coin) => {
          const isPositive = coin.price_change_percentage_24h >= 0;
          const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
          const bgColor = isPositive ? 'bg-green-50' : 'bg-red-50';
          
          return (
            <div 
              key={coin.symbol || coin.id} 
              className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-lg transition-all duration-200 hover:border-gray-300"
            >
              <div className="flex items-center gap-3 mb-3">
                <CoinIcon 
                  symbol={coin.symbol} 
                  name={coin.name}
                  image={coin.image}
                />
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{coin.symbol?.toUpperCase()}</p>
                  <p className="text-xs text-gray-500 truncate">{coin.name}</p>
                </div>
              </div>
              
              <p className="text-xl font-bold text-gray-900">
                ${coin.current_price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              
              <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold mt-2 ${bgColor} ${changeColor}`}>
                <span>{isPositive ? '↑' : '↓'}</span>
                {coin.price_change_percentage_24h != null 
                  ? `${Math.abs(coin.price_change_percentage_24h).toFixed(2)}%` 
                  : 'N/A'
                }
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <div className="flex items-center gap-2">
          <span className="text-blue-600 text-lg">ℹ️</span>
          <p className="text-sm text-blue-800">
            Data refreshes automatically every 10 seconds. Last updated: {new Date().toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Market;
