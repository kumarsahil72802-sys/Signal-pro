import React, { useState, useEffect } from 'react';

const SignalCard = ({ signal, isExpanded, onToggle, actionLoading, onTake, onMiss }) => {
  const conf = signal.confidence ?? 0;
  const isActive = signal.status !== 'CLOSED';
  const isTaken = signal.status === 'TAKEN';
  const isMissed = signal.status === 'MISSED';
  const [timeLeft, setTimeLeft] = useState('');

  // Countdown timer for expiry
  useEffect(() => {
    if (!signal.expireAt) return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const expire = new Date(signal.expireAt).getTime();
      const diff = expire - now;

      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${minutes} min`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [signal.expireAt]);

  const getConfLabel = (c) => {
    if (c >= 80) return '🔥 STRONG';
    if (c >= 65) return '✅ NORMAL';
    if (c >= 50) return '⚡ WEAK';
    return '❌ Low';
  };

  const getConfClass = (c) => {
    if (c >= 80) return 'bg-gradient-to-r from-green-500 to-emerald-500 text-white border-green-600';
    if (c >= 65) return 'bg-blue-500 text-white border-blue-600';
    if (c >= 50) return 'bg-yellow-500 text-white border-yellow-600';
    return 'bg-gray-400 text-white border-gray-500';
  };

  const profitPercent = ((signal.target - signal.entryPrice) / signal.entryPrice * 100).toFixed(2);
  const lossPercent = ((signal.stopLoss - signal.entryPrice) / signal.entryPrice * 100).toFixed(2);

  // Get reason indicators
  const reason = signal.reason || {};
  const getReasonIcon = (value) => {
    const positive = ['UPTREND', 'STRONG', 'HIGH', 'POSITIVE', 'BULLISH', 'OVERBOUGHT'];
    const negative = ['DOWNTREND', 'WEAK', 'LOW', 'NEGATIVE', 'BEARISH', 'OVERSOLD'];
    if (positive.includes(value)) return '✅';
    if (negative.includes(value)) return '⚠️';
    return '➖';
  };

  return (
    <div className={`
      bg-white border-2 rounded-2xl overflow-hidden transition-all duration-300
      ${isExpanded ? 'border-blue-400 shadow-lg' : 'border-gray-200 hover:border-gray-300'}
      ${conf < 50 ? 'opacity-70' : ''}
      ${isTaken ? 'ring-2 ring-green-400 ring-opacity-50' : ''}
      ${isMissed ? 'ring-2 ring-red-400 ring-opacity-50' : ''}
    `}>
      <div 
        className="p-5 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`
              w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold
              ${signal.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}
            `}>
              {signal.type === 'BUY' ? '📈' : '📉'}
            </div>
            
            <div>
              <h3 className="text-lg font-bold text-gray-900">{signal.coin}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`
                  px-2 py-0.5 text-xs font-bold rounded-full
                  ${signal.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}
                `}>
                  {signal.type}
                </span>
                <span className="text-sm text-gray-500">
                  Entry: <span className="font-semibold text-gray-900">${signal.entryPrice}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`
              px-3 py-1 text-sm font-semibold rounded-lg border
              ${getConfClass(conf)}
            `}>
              {getConfLabel(conf)}
            </span>
            
            <span className={`
              px-3 py-1 text-xs font-medium rounded-full
              ${signal.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : ''}
              ${signal.status === 'TAKEN' ? 'bg-green-100 text-green-700' : ''}
              ${signal.status === 'MISSED' ? 'bg-red-100 text-red-700' : ''}
              ${signal.status === 'CLOSED' ? 'bg-gray-100 text-gray-600' : ''}
            `}>
              {signal.status}
            </span>

            <svg 
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {!isExpanded && (
          <div className="mt-4 flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500">Target:</span>
              <span className="ml-1 font-semibold text-green-600">${signal.target}</span>
              <span className="ml-1 text-green-600">(+{profitPercent}%)</span>
            </div>
            <div>
              <span className="text-gray-500">Stop:</span>
              <span className="ml-1 font-semibold text-red-600">${signal.stopLoss}</span>
              <span className="ml-1 text-red-600">({lossPercent}%)</span>
            </div>
            <div>
              <span className="text-xs text-gray-500">Quality:</span>
              <span className={`ml-1 font-semibold ${
                signal.signalQuality === 'STRONG' ? 'text-green-600' :
                signal.signalQuality === 'NORMAL' ? 'text-blue-600' :
                'text-yellow-600'
              }`}>
                {signal.signalQuality || getConfLabel(conf)}
              </span>
            </div>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/50 p-5">
          {/* Missed Opportunity Banner */}
          {isMissed && (
            <div className="mb-4 p-4 bg-gradient-to-r from-red-500 to-red-600 rounded-xl text-white">
              <div className="flex items-center gap-3">
                <span className="text-2xl">❗</span>
                <div>
                  <p className="font-bold text-lg">Missed Opportunity</p>
                  <p className="text-red-100 text-sm">This signal hit its target but you didn't take it. Target was reached!</p>
                </div>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-xl border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Entry Price</p>
              <p className="text-2xl font-bold text-gray-900">${signal.entryPrice}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Target</p>
              <p className="text-2xl font-bold text-green-600">${signal.target}</p>
              <p className="text-sm text-green-600">+{profitPercent}% profit</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Stop Loss</p>
              <p className="text-2xl font-bold text-red-600">${signal.stopLoss}</p>
              <p className="text-sm text-red-600">{lossPercent}% loss</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Confidence</p>
              <p className="text-2xl font-bold text-blue-600">{conf}%</p>
              <p className="text-sm text-gray-600">{getConfLabel(conf)}</p>
            </div>
          </div>

          {/* Signal Analysis / Reason Section */}
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">📊 Signal Analysis</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                <span className="text-lg">{getReasonIcon(reason.trend)}</span>
                <div>
                  <p className="text-xs text-gray-500">Trend</p>
                  <p className="text-sm font-semibold text-gray-900">{reason.trend || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                <span className="text-lg">{getReasonIcon(reason.rsi)}</span>
                <div>
                  <p className="text-xs text-gray-500">RSI</p>
                  <p className="text-sm font-semibold text-gray-900">{reason.rsi || 'N/A'}</p>
                  {reason.rsiValue && <p className="text-xs text-gray-400">({reason.rsiValue})</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                <span className="text-lg">{getReasonIcon(reason.volume)}</span>
                <div>
                  <p className="text-xs text-gray-500">Volume</p>
                  <p className="text-sm font-semibold text-gray-900">{reason.volume || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                <span className="text-lg">{getReasonIcon(reason.sentiment)}</span>
                <div>
                  <p className="text-xs text-gray-500">News</p>
                  <p className="text-sm font-semibold text-gray-900">{reason.sentiment || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Timer & Metadata */}
          {signal.createdAt && (
            <div className="mb-4 flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2 text-gray-500">
                <span>🕐</span>
                <span>Generated: {new Date(signal.createdAt).toLocaleString()}</span>
              </div>
              {timeLeft && (
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                  timeLeft === 'Expired' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  <span>⏳</span>
                  <span className="font-semibold">
                    {timeLeft === 'Expired' ? 'Expired' : `Expires in ${timeLeft}`}
                  </span>
                </div>
              )}
            </div>
          )}

          {isActive ? (
            <div className="flex gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTake(signal._id);
                }}
                disabled={actionLoading === signal._id}
                className="
                  flex-1 px-6 py-3 text-sm font-bold bg-green-600 text-white 
                  rounded-xl hover:bg-green-700 
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all transform hover:scale-[1.02] active:scale-[0.98]
                "
              >
                {actionLoading === signal._id ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    Processing...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    🟢 Take Trade
                  </span>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMiss(signal._id);
                }}
                disabled={actionLoading === signal._id}
                className="
                  px-6 py-3 text-sm font-bold bg-red-600 text-white
                  rounded-xl hover:bg-red-700
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all
                "
              >
                🔴 Miss
              </button>
            </div>
          ) : (
            <div className="p-4 bg-gray-100 rounded-xl">
              <p className="text-sm font-medium text-gray-700">
                {signal.result === 'TARGET_HIT' && (
                  <span className="flex items-center gap-2 text-green-700">
                    ✅ <span className="font-bold">Target Hit!</span> This signal reached its profit target.
                  </span>
                )}
                {signal.result === 'SL_HIT' && (
                  <span className="flex items-center gap-2 text-red-700">
                    ❌ <span className="font-bold">Stop Loss Hit.</span> This signal hit the stop loss.
                  </span>
                )}
                {signal.result === 'PENDING' && (
                  <span className="flex items-center gap-2 text-gray-600">
                    ⏳ Signal completed without hitting target or stop loss.
                  </span>
                )}
              </p>
              {signal.closedAt && (
                <p className="text-xs text-gray-500 mt-1">
                  Closed: {new Date(signal.closedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Signals = ({ signals, loading, actionLoading, onTake, onMiss }) => {
  const [expandedId, setExpandedId] = useState(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-4xl">📡</span>
        </div>
        <p className="text-gray-500 text-lg">No signals available</p>
        <p className="text-gray-400 text-sm mt-2">Signals will appear here when the engine generates them</p>
      </div>
    );
  }

  const activeSignals = signals.filter(s => s.status !== 'CLOSED');
  const closedSignals = signals.filter(s => s.status === 'CLOSED');
  const singleSignal = activeSignals.length === 1;

  if (singleSignal) {
    const signal = activeSignals[0];
    return (
      <div>
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎯</span>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">New Signal Available!</h2>
              <p className="text-gray-500 text-sm">Review the details below and take action</p>
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto">
          <SignalCard 
            signal={signal} 
            isExpanded={true}
            onToggle={() => {}}
            actionLoading={actionLoading}
            onTake={onTake}
            onMiss={onMiss}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Trading Signals</h2>
        <p className="text-gray-500 text-sm mt-1">
          {activeSignals.length} active • {closedSignals.length} completed • {signals.length} total
        </p>
      </div>

      <div className="space-y-4">
        {activeSignals.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
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
                />
              ))}
            </div>
          </div>
        )}

        {closedSignals.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
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
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📊</span>
            <div>
              <p className="text-2xl font-bold text-blue-900">{activeSignals.filter(s => s.status === 'ACTIVE').length}</p>
              <p className="text-sm text-blue-700">Waiting</p>
            </div>
          </div>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-2xl font-bold text-green-900">{activeSignals.filter(s => s.status === 'TAKEN').length}</p>
              <p className="text-sm text-green-700">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📈</span>
            <div>
              <p className="text-2xl font-bold text-purple-900">{signals.length}</p>
              <p className="text-sm text-purple-700">Total Generated</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signals;
