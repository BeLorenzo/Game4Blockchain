import React from 'react'
import { Trophy, Users, TrendingUp, TrendingDown } from 'lucide-react'

interface SessionRound {
  round: number
  agent: string
  choice: number
  result: string
  profit: number
  reasoning: string
  role?: string
  proposalAccepted?: boolean
  roundEliminated?: number
}

interface SessionData {
  session: number
  timestamp: string
  game: string
  rounds: SessionRound[]
  winner: { name: string; profit: number } | null
  gameSpecificStats?: {
    cooperationRate?: number
    stags?: number
    hares?: number
  }
}

interface SessionHistoryCardProps {
  session: SessionData
  onClick?: () => void
}

const AGENT_COLORS: Record<string, string> = {
  Alpha: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  Beta: 'text-red-400 bg-red-500/10 border-red-500/30',
  Gamma: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  Delta: 'text-gray-400 bg-gray-500/10 border-gray-500/30',
  Epsilon: 'text-pink-400 bg-pink-500/10 border-pink-500/30',
  Zeta: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  Eta: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
}

export const SessionHistoryCard: React.FC<SessionHistoryCardProps> = ({ session, onClick }) => {
  // Aggregate agent results
  const agentResults = new Map<string, { profit: number; choice?: number; result: string }>()
  session.rounds.forEach(r => {
    if (!agentResults.has(r.agent)) {
      agentResults.set(r.agent, { profit: 0, choice: r.choice, result: r.result })
    }
    const current = agentResults.get(r.agent)!
    current.profit += r.profit
  })

  const sortedAgents = Array.from(agentResults.entries())
    .sort(([,a], [,b]) => b.profit - a.profit)

  const date = new Date(session.timestamp)
  const formattedDate = date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div 
      className="bg-base-200 rounded-lg border border-white/5 overflow-hidden hover:border-white/10 transition-all cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="p-4 bg-black/30 border-b border-white/5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="badge badge-neutral font-mono">Session #{session.session}</div>
          <span className="text-xs text-gray-500">{formattedDate}</span>
        </div>
        
        {session.winner && (
          <div className="flex items-center gap-2">
            <Trophy size={14} className="text-yellow-500" />
            <span className={`text-sm font-bold ${
              AGENT_COLORS[session.winner.name]?.split(' ')[0] || 'text-white'
            }`}>
              {session.winner.name}
            </span>
            <span className={`text-sm font-mono ${
              session.winner.profit >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {session.winner.profit >= 0 ? '+' : ''}{session.winner.profit.toFixed(1)}A
            </span>
          </div>
        )}
      </div>

      {/* Game-Specific Stats */}
      {session.gameSpecificStats && (
        <div className="p-3 bg-white/5 border-b border-white/5">
          {session.gameSpecificStats.cooperationRate !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 flex items-center gap-2">
                <Users size={12} />
                Cooperation Rate
              </span>
              <div className="flex items-center gap-2">
                <div className="text-sm font-bold text-primary">
                  {session.gameSpecificStats.cooperationRate.toFixed(1)}%
                </div>
                <div className="text-[10px] text-gray-500">
                  ({session.gameSpecificStats.stags}🦌 / {session.gameSpecificStats.hares}🐇)
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agent Results */}
      <div className="p-3">
        <div className="grid grid-cols-1 gap-2">
          {sortedAgents.map(([agentName, data], idx) => {
            const colorClasses = AGENT_COLORS[agentName] || 'text-white bg-white/5 border-white/10'
            const isWinner = idx === 0 && data.profit > 0
            
            return (
              <div 
                key={agentName}
                className={`flex items-center justify-between p-2 rounded border transition-all ${colorClasses} ${
                  isWinner ? 'ring-1 ring-yellow-500/30' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  {isWinner && <Trophy size={12} className="text-yellow-500" />}
                  <span className="text-sm font-bold">{agentName}</span>
                  {data.choice !== undefined && (
                    <span className="text-xs opacity-60">
                      {session.game === 'StagHunt' ? (data.choice === 1 ? '🦌' : '🐇') : `#${data.choice}`}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-2">
                  <div className={`text-xs px-2 py-0.5 rounded uppercase font-bold ${
                    data.result === 'WIN' ? 'bg-green-500/20 text-green-400' :
                    data.result === 'LOSS' ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {data.result}
                  </div>
                  
                  <div className={`text-sm font-mono font-bold min-w-[60px] text-right ${
                    data.profit >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {data.profit >= 0 ? '+' : ''}{data.profit.toFixed(1)}A
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="px-3 pb-3 flex justify-between text-[10px] text-gray-600">
        <span>{session.rounds.length} total actions</span>
        <span>{sortedAgents.length} agents participated</span>
      </div>
    </div>
  )
}

// Componente per lista di sessioni
export const SessionHistoryList: React.FC<{ 
  sessions: SessionData[]; 
  loading: boolean;
  onSessionClick?: (session: SessionData) => void;
}> = ({ sessions, loading, onSessionClick }) => {
  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-md text-primary"></span>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center opacity-40 italic p-8 border-2 border-dashed border-white/5 rounded-lg">
        <div className="text-3xl mb-2">📊</div>
        <div className="text-sm">No sessions found. Launch your first experiment!</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <SessionHistoryCard 
          key={session.session} 
          session={session}
          onClick={() => onSessionClick?.(session)}
        />
      ))}
    </div>
  )
}