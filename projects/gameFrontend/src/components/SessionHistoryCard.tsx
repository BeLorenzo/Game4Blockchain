import React, { useState, useMemo } from 'react'
import { ChevronDown, Clock, AlertCircle, Skull, Trophy, TrendingDown, CheckCircle, XCircle } from 'lucide-react'


/**
 * Represents a single action/event within a game round.
 */
interface RawRoundAction {
  round: number
  agent: string
  choice: number
  result: string
  profit: number
  reasoning: string
  role?: string
  proposalAccepted?: boolean
  proposalDistribution?: number[]
  roundEliminated?: number
  timestamp?: string | number
  virtualSession?: number
}

/**
 * Represents a complete game session with all its rounds.
 */
interface SessionData {
  session: number
  timestamp: string | number
  game: string
  rounds: RawRoundAction[]
  virtualId?: number
}

// Game-specific icon mappings
const WEEKLY_ICONS: Record<number, string> = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' }


/**
 * Processes raw session data to calculate statistics and categorize agents.
 * 
 * Analyzes all round actions to:
 * - Calculate total profit per agent
 * - Determine final outcome (WIN/LOSS/ELIMINATED/SURVIVED)
 * - Track agent choices and roles
 * - Identify unique rounds
 */
const processSessionStats = (session: SessionData) => {
  const agentMap = new Map<string, any>()
  const roundsSet = new Set<number>()

  session.rounds.forEach(r => {
    roundsSet.add(r.round)
    if (!agentMap.has(r.agent)) {
      agentMap.set(r.agent, { 
        name: r.agent, 
        totalProfit: 0, 
        lastChoice: r.choice,
        result: 'SURVIVED',
        role: r.role
      })
    }
    const ag = agentMap.get(r.agent)!
    ag.totalProfit += r.profit
    ag.lastChoice = r.choice
    if (r.role) ag.role = r.role 

    if (r.result === 'ELIMINATED') ag.result = 'ELIMINATED'
    else if (r.profit > 0.01) ag.result = 'WIN'
    else if (r.profit < -0.01) ag.result = 'LOSS'
  })

  // Sort agents by total profit (highest first)
  const agents = Array.from(agentMap.values()).sort((a, b) => b.totalProfit - a.profit)
  
  return { 
    winners: agents.filter(a => a.result === 'WIN'), 
    losers: agents.filter(a => a.result === 'LOSS'), 
    eliminated: agents.filter(a => a.result === 'ELIMINATED'), 
    neutral: agents.filter(a => a.result === 'SURVIVED' && Math.abs(a.totalProfit) < 0.01), 
    rounds: Array.from(roundsSet).sort((a, b) => a - b)
  }
}

/**
 * Normalizes session data for consistent display.
 * 
 * Performs three key operations:
 * 1. Sorts sessions chronologically (oldest to newest)
 * 2. Assigns sequential virtual IDs (1, 2, 3...)
 * 3. Reverses order for display (newest first)
 */
const normalizeSessions = (sessions: SessionData[]) => {
    if (!sessions || sessions.length === 0) return [];

    // 1. Sort CHRONOLOGICALLY (oldest to newest)
    const sorted = [...sessions].sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeA - timeB;
    });

    // 2. Assign progressive IDs (1, 2, 3...)
    // Oldest session gets virtualId = 1, newest = N
    const labeled = sorted.map((s, index) => ({
        ...s,
        virtualId: index + 1 
    }));

    return labeled.reverse();
}

/**
 * SessionHistoryList Component
 * 
 * Displays a list of game session history items with expandable details.
 * Handles loading states, empty states, and normalizes session data for display.
 * 
 * Features:
 * - Sequential numbering of sessions (1 = oldest, N = newest)
 * - Expandable/collapsible session details
 * - Game-specific visualization (standard games vs PirateGame)
 * - Real-time statistics calculation
 * - Responsive grid layout for session details
 */
export const SessionHistoryList: React.FC<{ 
  sessions: SessionData[]; 
  loading: boolean;
}> = ({ sessions, loading }) => {
  
  if (loading) return <div className="text-center p-8 text-gray-500 font-mono text-xs animate-pulse">Loading archive...</div>
  if (!sessions || sessions.length === 0) return <div className="text-center p-8 text-gray-600 font-mono text-xs border border-dashed border-white/10 rounded">No history available</div>

  const normalizedSessions = useMemo(() => normalizeSessions(sessions), [sessions]);

  return (
    <div className="space-y-3">
      {/* Header with total count */}
      <div className="text-right text-[10px] text-gray-500 font-mono mb-2 px-1">
        Total Sessions: {normalizedSessions.length}
      </div>

      {/* Render each session as a history item */}
      {normalizedSessions.map((session) => (
        <HistoryItem 
            key={`${session.session}-${session.timestamp}`} 
            session={session} 
        />
      ))}
    </div>
  )
}


/**
 * HistoryItem Component
 * 
 * Represents a single game session in the history list.
 * Shows compact summary header and expandable detailed view.
 */
const HistoryItem = ({ session }: { session: SessionData }) => {
  const [isOpen, setIsOpen] = useState(false)
  const stats = processSessionStats(session)
  const date = new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  let borderColor = 'border-white/5'
  if (stats.eliminated.length > 0) borderColor = 'border-red-500/30'
  else if (stats.winners.length > 0) borderColor = 'border-green-500/30'

  return (
    <div className={`bg-[#1a1a1a] rounded border ${borderColor} overflow-hidden transition-all duration-200`}>
      
      {/* COMPACT HEADER - Clickable for expansion */}
      <div 
        className="p-3 flex items-center justify-between cursor-pointer hover:bg-white/5 select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs text-gray-500 flex items-center gap-2">
            {/* Sequential ID (#5, #4, ... #1) */}
            <span className="text-cyan-400 font-bold">#{session.virtualId}</span>
            <span className="opacity-50 flex items-center gap-1"><Clock size={10}/> {date}</span>
          </div>
          
          <div className="text-xs font-medium text-gray-300">
            {stats.eliminated.length > 0 ? (
                <span className="text-red-400 flex items-center gap-1"><Skull size={12}/> {stats.eliminated.length} Eliminated</span>
            ) : (
                <span className="text-gray-400">
                    <span className="text-green-400">{stats.winners.length} Won</span>, 
                    <span className="text-red-400 ml-2">{stats.losers.length} Losers</span>
                </span>
            )}
          </div>
        </div>

        {/* Expand/collapse indicator */}
        <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronDown size={14} className="text-gray-500" />
        </div>
      </div>

      {/* EXPANDED DETAIL VIEW */}
      {isOpen && (
        <div className="bg-black/20 border-t border-white/5 p-4 text-xs font-mono animate-in slide-in-from-top-1 fade-in duration-200">
          {session.game === 'PirateGame' ? (
             <PirateGameDetail session={session} finalStats={stats} />
          ) : (
             <StandardGameDetail stats={stats} gameName={session.game} />
          )}
        </div>
      )}
    </div>
  )
}


/**
 * StandardGameDetail Component
 * 
 * Displays detailed statistics for standard games (non-PirateGame).
 * Shows winners and losers with their choices and profits.
 */
const StandardGameDetail = ({ stats, gameName }: { stats: ReturnType<typeof processSessionStats>, gameName: string }) => {
    
    /**
     * Decodes numeric choice into human-readable format based on game type.
     */
    const decodeChoice = (choice: number) => {
        if (gameName === 'StagHunt') return choice === 1 ? '🦌 STAG' : '🐇 HARE';
        if (gameName === 'WeeklyGame') return WEEKLY_ICONS[choice] || choice;
        return choice;
    }

    return (
        <div className="grid grid-cols-2 gap-6">
            {/* Winners Column */}
            <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-green-500 mb-2 flex items-center gap-1">
                    <Trophy size={10}/> Winners
                </div>
                {stats.winners.length === 0 && <div className="text-gray-600 italic">-</div>}
                {stats.winners.map(ag => (
                    <div key={ag.name} className="flex justify-between mb-1 group">
                        <span className="text-white font-bold">{ag.name}</span>
                        <span className="text-gray-500 opacity-70">[{decodeChoice(ag.lastChoice)}]</span>
                        <span className="text-green-400 font-mono">+{ag.totalProfit.toFixed(1)}A</span>
                    </div>
                ))}
            </div>
            
            {/* Losers Column */}
            <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-red-500 mb-2 flex items-center gap-1">
                    <TrendingDown size={10}/> Losers
                </div>
                {stats.losers.length === 0 && <div className="text-gray-600 italic">-</div>}
                {stats.losers.map(ag => (
                    <div key={ag.name} className="flex justify-between mb-1">
                        <span className="text-gray-400">{ag.name}</span>
                        <span className="text-gray-600">[{decodeChoice(ag.lastChoice)}]</span>
                        <span className="text-red-400 font-mono">{ag.totalProfit.toFixed(1)}A</span>
                    </div>
                ))}
                
                {/* Break-even players */}
                {stats.neutral.length > 0 && (
                    <div className="mt-2 text-gray-500 italic">
                        Break-even: {stats.neutral.map(a => a.name).join(', ')}
                    </div>
                )}
            </div>
        </div>
    )
}

/**
 * PirateGameDetail Component
 * 
 * Displays detailed round-by-round timeline and final statistics for Pirate Game.
 * Shows proposal history, voting results, eliminations, and final outcomes.
 */
const PirateGameDetail = ({ session, finalStats }: { session: SessionData, finalStats: ReturnType<typeof processSessionStats> }) => {
    
    /**
     * Groups round actions by round number for timeline display.
     * Memoized to prevent recalculation on re-renders.
     */
    const roundsMap = useMemo(() => {
        const map = new Map<number, RawRoundAction[]>()
        session.rounds.forEach(r => {
            if (!map.has(r.round)) map.set(r.round, [])
            map.get(r.round)!.push(r)
        })
        return map
    }, [session])

    const sortedRounds = Array.from(roundsMap.keys()).sort((a, b) => a - b)

    return (
        <div className="space-y-6">
            
            {/* ROUND TIMELINE */}
            <div className="space-y-4">
                {sortedRounds.map(roundNum => {
                    const logs = roundsMap.get(roundNum)!
                    
                    const eliminated = logs.find(l => l.result === 'ELIMINATED')?.agent
                    
                    let proposer = logs.find(l => l.role === 'proposer')?.agent
                    if (!proposer && eliminated) proposer = eliminated 
                    if (!proposer) proposer = "Unknown"

                    const yesVotes = logs.filter(l => l.choice === 1 || l.role === 'proposer').length
                    const noVotes = logs.filter(l => l.choice === 0 && l.role !== 'proposer').length
                    const totalVotes = yesVotes + noVotes
                    
                    const isAccepted = logs.some(l => l.proposalAccepted === true)
                    const outcomeText = eliminated 
                        ? 'REJECTED (Mutiny)' 
                        : (isAccepted ? 'ACCEPTED' : 'IN PROGRESS')
                    
                    const outcomeColor = eliminated ? 'text-red-400' : (isAccepted ? 'text-green-400' : 'text-gray-400')

                    return (
                        <div key={roundNum} className="relative pl-4 border-l border-white/10 pb-1">
                            {/* Round indicator dot */}
                            <div className={`absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full ${eliminated ? 'bg-red-500' : 'bg-gray-600'}`}></div>
                            
                            <div className="flex justify-between items-start mb-1">
                                <span className="text-gray-300 font-bold">
                                    Round {roundNum}: Proposal by <span className="text-cyan-400">{proposer}</span>
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded bg-white/5 ${outcomeColor}`}>
                                    {outcomeText}
                                </span>
                            </div>

                            {/* Voting breakdown */}
                            <div className="flex gap-4 text-gray-500 text-[10px] mb-2">
                                <span className="flex items-center gap-1"><CheckCircle size={10} className="text-green-500"/> {yesVotes} Yes</span>
                                <span className="flex items-center gap-1"><XCircle size={10} className="text-red-500"/> {noVotes} No</span>
                                <span>(Total: {totalVotes})</span>
                            </div>

                            {/* Elimination notice */}
                            {eliminated && (
                                <div className="text-red-400 bg-red-500/5 px-3 py-1.5 rounded border border-red-500/10 inline-flex items-center gap-2">
                                    <Skull size={12}/> 
                                    <span><b>{eliminated}</b> was thrown overboard! (-10 ALGO)</span>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* FINAL STATISTICS */}
            <div className="pt-4 border-t border-white/10">
                <div className="grid grid-cols-2 gap-6">
                    {/* Survivors Column */}
                    <div>
                        <div className="text-[9px] uppercase tracking-wider font-bold text-green-500 mb-2">Survivors (Loot)</div>
                        {finalStats.winners.map(p => (
                            <div key={p.name} className="flex justify-between mb-1">
                                <span className="text-white font-bold">{p.name}</span>
                                <span className="text-green-400 font-mono">+{p.totalProfit.toFixed(1)}A</span>
                            </div>
                        ))}
                        {finalStats.neutral.map(p => (
                            <div key={p.name} className="flex justify-between mb-1 text-gray-500">
                                <span>{p.name}</span>
                                <span className="font-mono">0.0A</span>
                            </div>
                        ))}
                        {finalStats.losers.length > 0 && (
                            <div className="mt-3 pt-2 border-t border-white/5">
                                <div className="text-[8px] uppercase tracking-wider font-bold text-orange-400 mb-1">Survivors (Loss)</div>
                                {finalStats.losers.map(p => (
                                    <div key={p.name} className="flex justify-between mb-1 text-gray-400">
                                        <span>{p.name}</span>
                                        <span className="text-red-400 font-mono">{p.totalProfit.toFixed(1)}A</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {/* Casualties Column */}
                    <div>
                        <div className="text-[9px] uppercase tracking-wider font-bold text-red-500 mb-2">Casualties</div>
                        {finalStats.eliminated.length === 0 && <div className="text-gray-600 italic">-</div>}
                        {finalStats.eliminated.map(p => (
                            <div key={p.name} className="flex justify-between mb-1 text-gray-500 line-through decoration-red-500/50">
                                <span>{p.name}</span>
                                <span className="text-red-900 font-mono">-10.0A</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}