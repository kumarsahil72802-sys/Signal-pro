import { useState, useEffect } from 'react';
import { getStats } from '../services/api';

const Stats = ({ loading }) => {
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const fetchStats = () => {
    getStats()
      .then((res) => setStats(res.data))
      .catch((err) => console.error('Failed to fetch stats:', err))
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const getWinRateColor = (rate) => {
    if (rate >= 60) return 'bg-green-100 text-green-800 border-green-200';
    if (rate >= 50) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-red-100 text-red-800 border-red-200';
  };

  const getWinRateText = (rate) => {
    if (rate >= 60) return 'text-green-600';
    if (rate >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (statsLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!stats || stats.totalSignals === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">📊</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Performance Data Yet</h3>
        <p className="text-gray-500">Complete signals will appear here once they close.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Performance Dashboard</h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <p className="text-sm text-gray-500 mb-1">Total Signals</p>
          <p className="text-2xl font-bold text-gray-900">{stats.totalSignals}</p>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <p className="text-sm text-gray-500 mb-1">Wins</p>
          <p className="text-2xl font-bold text-green-600">{stats.wins}</p>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <p className="text-sm text-gray-500 mb-1">Losses</p>
          <p className="text-2xl font-bold text-red-600">{stats.losses}</p>
        </div>
        
        <div className={`rounded-lg border p-4 shadow-sm ${getWinRateColor(stats.winRate)}`}>
          <p className="text-sm opacity-80 mb-1">Win Rate</p>
          <p className={`text-2xl font-bold ${getWinRateText(stats.winRate)}`}>
            {stats.winRate}%
          </p>
        </div>
      </div>

      {stats.last10 && stats.last10.total > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Last 10 Results</h3>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: stats.last10.total }).map((_, i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold ${
                  i < stats.last10.wins
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {i < stats.last10.wins ? 'W' : 'L'}
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-3">
            Last 10: {stats.last10.wins}W / {stats.last10.total - stats.last10.wins}L ({stats.last10.winRate}% win rate)
          </p>
        </div>
      )}

      {stats.avgRR && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Avg Risk:Reward</p>
              <p className="text-lg font-semibold text-gray-900">1:{stats.avgRR}</p>
            </div>
            {stats.bestCoin && (
              <div>
                <p className="text-sm text-gray-500">Best Performing</p>
                <p className="text-lg font-semibold text-green-600">{stats.bestCoin}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Stats;
