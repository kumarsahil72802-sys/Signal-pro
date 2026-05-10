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
  const safeStats = stats || {}
  const totalGenerated = Number(safeStats.totalGenerated || safeStats.totalSignals || 0)
  const totalTaken = Number(safeStats.totalTaken || 0)
  const wins = Number(safeStats.wins || 0)
  const losses = Number(safeStats.losses || 0)
  const winRate = Number(safeStats.winRate || 0)
  const last10 = safeStats.last10 || { total: 0, wins: 0, winRate: 0 }
  const last10Sequence = Array.isArray(last10.sequence) ? last10.sequence : []
  const displaySequence = last10Sequence.length > 0
    ? last10Sequence
    : Array.from({ length: last10.total }).map((_, i) => (i < last10.wins ? 'W' : 'L'))
  const avgRR = Number(safeStats.avgRR || 0)
  const bestCoin = safeStats.bestCoin || null

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-[#315077] bg-[linear-gradient(140deg,#0f1c33,#122745)] p-5">
        <p className="cc-mono text-[11px] uppercase tracking-[0.18em] text-[#9bb5db]">Performance Layer</p>
        <h2 className="text-2xl font-bold text-white mt-1">Execution Edge Dashboard</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Total Generated</p>
          <p className="text-2xl font-bold text-white">{totalGenerated}</p>
        </div>

        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Total Taken</p>
          <p className="text-2xl font-bold text-white">{totalTaken}</p>
        </div>

        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Wins</p>
          <p className="text-2xl font-bold text-[#64f2b3]">{wins}</p>
        </div>

        <div className="bg-[#111b2d] rounded-xl border border-[#304a70] p-4">
          <p className="text-sm text-[#8ea2c4] mb-1">Losses</p>
          <p className="text-2xl font-bold text-[#ff8fa1]">{losses}</p>
        </div>

        <div className={`rounded-xl border p-4 ${getWinRateTone(winRate)}`}>
          <p className="text-sm opacity-80 mb-1">Win Rate</p>
          <p className="text-2xl font-bold">{winRate}%</p>
        </div>
      </div>

      {last10.total > 0 && (
        <div className="bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4 mb-6">
          <h3 className="text-sm font-medium text-[#c3d2eb] mb-3">Last 10 Results</h3>
          <div className="flex flex-wrap gap-2">
            {displaySequence.map((result, i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold ${
                  result === 'W'
                    ? 'bg-[#173427] text-[#64f2b3]'
                    : 'bg-[#3b1b26] text-[#ff8fa1]'
                }`}
              >
                {result === 'W' ? 'W' : 'L'}
              </div>
            ))}
          </div>
          <p className="text-xs text-[#6f83a6] mt-2">Order: latest to oldest</p>
          <p className="text-sm text-[#8ea2c4] mt-3">
            Last 10: {last10.wins}W / {last10.total - last10.wins}L ({last10.winRate}% win rate)
          </p>
        </div>
      )}

      {avgRR > 0 && (
        <div className="bg-[#111b2d] rounded-xl border border-[#2a3a55] p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-[#8ea2c4]">Avg Risk:Reward</p>
              <p className="text-lg font-semibold text-white">1:{avgRR}</p>
            </div>
            {bestCoin && (
              <div>
                <p className="text-sm text-[#8ea2c4]">Best Performing</p>
                <p className="text-lg font-semibold text-[#64f2b3]">{bestCoin}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Stats
