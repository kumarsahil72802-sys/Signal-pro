import { useState, useEffect } from 'react'
import { getStats } from '../services/api'

const Stats = ({ loading }) => {
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const fetchStats = () => {
    getStats()
      .then((res) => setStats(res.data))
      .catch((err) => console.error('Failed to fetch stats:', err))
      .finally(() => setStatsLoading(false))
  }

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const getWinRateTone = (rate) => {
    if (rate >= 60) return 'text-[#64f2b3] border-[#2a6b4e] bg-[#173427]'
    if (rate >= 50) return 'text-[#ffd56a] border-[#6b551f] bg-[#3a2d10]'
    return 'text-[#ff8fa1] border-[#6b3040] bg-[#3b1b26]'
  }

  if (statsLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#f0b90b]"></div>
      </div>
    )
  }

  if (!stats || stats.totalTaken === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-full border border-[#2a3a55] bg-[#111b2d] text-[#f0b90b] font-bold mx-auto mb-4 flex items-center justify-center">
          PNL
        </div>
        <h3 className="text-lg font-medium text-white mb-2">No Performance Data Yet</h3>
        <p className="text-[#8ea2c4]">Complete signals will appear here once they close.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-[#315077] bg-[linear-gradient(140deg,#0f1c33,#122745)] p-5">
        <p className="cc-mono text-[11px] uppercase tracking-[0.18em] text-[#9bb5db]">Performance Layer</p>
        <h2 className="text-2xl font-bold text-white mt-1">Execution Edge Dashboard</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Total Generated</p>
          <p className="text-2xl font-bold text-white">{stats.totalGenerated}</p>
        </div>

        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Total Taken</p>
          <p className="text-2xl font-bold text-white">{stats.totalTaken}</p>
        </div>

        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Wins</p>
          <p className="text-2xl font-bold text-[#64f2b3]">{stats.wins}</p>
        </div>

        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Losses</p>
          <p className="text-2xl font-bold text-[#ff8fa1]">{stats.losses}</p>
        </div>

        <div className={`rounded-xl border p-4 ${getWinRateTone(stats.winRate)}`}>
          <p className="text-sm opacity-80 mb-1">Win Rate</p>
          <p className="text-2xl font-bold">{stats.winRate}%</p>
        </div>
      </div>

      {stats.last10 && stats.last10.total > 0 && (
        <div className="bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4 mb-6">
          <h3 className="text-sm font-medium text-[#c3d2eb] mb-3">Last 10 Results</h3>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: stats.last10.total }).map((_, i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold ${
                  i < stats.last10.wins
                    ? 'bg-[#173427] text-[#64f2b3]'
                    : 'bg-[#3b1b26] text-[#ff8fa1]'
                }`}
              >
                {i < stats.last10.wins ? 'W' : 'L'}
              </div>
            ))}
          </div>
          <p className="text-sm text-[#8ea2c4] mt-3">
            Last 10: {stats.last10.wins}W / {stats.last10.total - stats.last10.wins}L ({stats.last10.winRate}% win rate)
          </p>
        </div>
      )}

      {stats.avgRR && (
        <div className="bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-[#8ea2c4]">Avg Risk:Reward</p>
              <p className="text-lg font-semibold text-white">1:{stats.avgRR}</p>
            </div>
            {stats.bestCoin && (
              <div>
                <p className="text-sm text-[#8ea2c4]">Best Performing</p>
                <p className="text-lg font-semibold text-[#64f2b3]">{stats.bestCoin}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Stats
