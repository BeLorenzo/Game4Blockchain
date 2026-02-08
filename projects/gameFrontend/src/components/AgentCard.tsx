import React, { useEffect, useState } from 'react'

interface AgentProfile {
  name: string
  description: string
  personality: {
    riskTolerance: number
    trustInOthers: number
    wealthFocus: number
    fairnessFocus: number
    curiosity: number
  }
  color: string
  icon: string
}

interface AgentCardProps {
  agent: AgentProfile
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent }) => {
  const [stats, setStats] = useState<{
    totalGames: number
    winRate: number
    totalProfit: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch real stats from server
    fetch('http://localhost:3000/api/agent-stats')
      .then(res => res.json())
      .then(data => {
        if (data && data[agent.name]) {
          setStats(data[agent.name])
        } else {
          setStats({ totalGames: 0, winRate: 0, totalProfit: 0 })
        }
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load agent stats:', err)
        setLoading(false)
      })
  }, [agent.name])

  const getBarColor = (value: number) => {
    if (value >= 0.7) return 'bg-green-500'
    if (value >= 0.4) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  return (
    <div className="relative w-full rounded-2xl border border-white/10 bg-[#111] shadow-xl hover:shadow-[0_0_30px_rgba(255,255,255,0.05)] transition-all duration-300 overflow-hidden group">
      
      {/* Background gradient */}
      <div className={`absolute top-0 right-0 w-32 h-32 ${agent.color} opacity-10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none transition-all duration-500 group-hover:opacity-20`}></div>

      <div className="p-6 md:p-8 relative z-10">
        
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="text-4xl md:text-5xl filter drop-shadow-lg transition-transform duration-300 group-hover:scale-110">
            {agent.icon}
          </div>
          
          <div className="flex-1">
            <h3 className={`text-2xl md:text-3xl font-black uppercase tracking-wider text-white mb-2`}>
              {agent.name}
            </h3>
            <p className="text-sm text-gray-400 font-medium leading-relaxed">
              {agent.description}
            </p>
          </div>
        </div>

        {/* Stats (from real JSON files) */}
        {loading ? (
          <div className="flex justify-center items-center h-20 mb-6">
            <span className="loading loading-spinner loading-sm text-primary"></span>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-3 gap-3 mb-6 p-4 rounded-lg bg-black/40 border border-white/5">
            <div className="text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Games</div>
              <div className="text-xl font-bold text-white">{stats.totalGames}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Win Rate</div>
              <div className="text-xl font-bold text-primary">{stats.winRate.toFixed(0)}%</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Profit</div>
              <div className={`text-xl font-bold ${stats.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toFixed(1)}A
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-xs text-gray-600 mb-6 p-4">
            No stats available yet. Run some simulations!
          </div>
        )}

        {/* Personality Traits */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Personality Matrix</h4>
          
          {Object.entries(agent.personality).map(([trait, value]) => (
            <div key={trait} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400 capitalize">{trait.replace(/([A-Z])/g, ' $1').trim()}</span>
                <span className="text-white font-mono">{(value * 10).toFixed(1)}/10</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${getBarColor(value)}`}
                  style={{ width: `${value * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Preset degli agenti dalla simulazione
export const SIMULATION_AGENTS: AgentProfile[] = [
  {
    name: 'Alpha',
    description: 'EV Maximizer. Cold, calculated, profit-driven. Focuses on expected value above all else.',
    personality: { riskTolerance: 0.3, curiosity: 1.0, trustInOthers: 0.5, wealthFocus: 1.0, fairnessFocus: 0.0 },
    color: 'bg-blue-500',
    icon: '🎯'
  },
  {
    name: 'Beta',
    description: 'Paranoid. Extremely risk-averse, trusts no one, plays it safe at all costs.',
    personality: { riskTolerance: 0.1, curiosity: 0.2, trustInOthers: 0.0, wealthFocus: 1.0, fairnessFocus: 0.0 },
    color: 'bg-red-500',
    icon: '🛡️'
  },
  {
    name: 'Gamma',
    description: 'Gambler. High risk, high reward. Thrives on chaos and uncertainty.',
    personality: { riskTolerance: 0.9, curiosity: 0.8, trustInOthers: 0.5, wealthFocus: 0.8, fairnessFocus: 0.0 },
    color: 'bg-yellow-500',
    icon: '🎲'
  },
  {
    name: 'Delta',
    description: 'Mirror. Balanced approach, adapts to others, seeks equilibrium and fairness.',
    personality: { riskTolerance: 0.5, curiosity: 0.5, trustInOthers: 0.5, wealthFocus: 0.5, fairnessFocus: 1.0 },
    color: 'bg-gray-500',
    icon: '⚖️'
  },
  {
    name: 'Epsilon',
    description: 'Altruist. Values fairness and cooperation, willing to sacrifice personal gain.',
    personality: { riskTolerance: 0.4, curiosity: 0.6, trustInOthers: 1.0, wealthFocus: 0.1, fairnessFocus: 0.9 },
    color: 'bg-pink-500',
    icon: '🤝'
  },
  {
    name: 'Zeta',
    description: 'Trend Follower. Highly adaptive, follows winning strategies of others.',
    personality: { riskTolerance: 0.5, curiosity: 0.5, trustInOthers: 0.5, wealthFocus: 0.9, fairnessFocus: 0.0 },
    color: 'bg-purple-500',
    icon: '📈'
  },
  {
    name: 'Eta',
    description: 'Contrarian. Goes against the grain, seeks unconventional strategies.',
    personality: { riskTolerance: 0.8, curiosity: 0.9, trustInOthers: 0.2, wealthFocus: 1.0, fairnessFocus: 0.1 },
    color: 'bg-orange-500',
    icon: '⚡'
  }
]