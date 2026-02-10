import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, ChevronDown, ChevronUp, Brain } from 'lucide-react'
import { SimulationHero } from '../components/SimulationHero'
import { AgentCard, SIMULATION_AGENTS } from '../components/AgentCard'
import { SessionHistoryList } from '../components/SessionHistoryCard'

const GAMES = [
  { 
    id: 'StagHunt', 
    name: 'Stag Hunt', 
    desc: 'Coordination dilemma. Hunt Stag (risky) or Hare (safe)?', 
    color: 'from-green-500/20 to-emerald-500/5',
    icon: '🦌',
    rules: ['High Risk = High Reward', 'Safe Choice = Guaranteed Return', 'Team Coordination Required']
  },
  { 
    id: 'PirateGame', 
    name: 'Pirate Game', 
    desc: 'Sequential bargaining. Captain proposes split, crew votes, losers walk the plank.', 
    color: 'from-red-500/20 to-orange-500/5',
    icon: '🏴‍☠️',
    rules: ['Captain Proposes Split', 'Majority Vote Required', 'Rejected = Elimination']
  },
  { 
    id: 'WeeklyGame', 
    name: 'Weekly Lottery', 
    desc: 'Minority game. Choose the least popular day to maximize your share.', 
    color: 'from-blue-500/20 to-cyan-500/5',
    icon: '📅',
    rules: ['Pick a Day (0-6)', 'Fewer Picks = Bigger Share', 'Avoid the Crowd']
  },
  { 
    id: 'GuessGame', 
    name: 'Guess Game', 
    desc: 'Guess 2/3 of the average. A test of recursive reasoning.', 
    color: 'from-purple-500/20 to-indigo-500/5',
    icon: '🎯',
    rules: ['Guess 0-100', 'Target = 2/3 of Average', 'Higher Order Thinking']
  },
]

export default function SimulationHome() {
  const navigate = useNavigate()
  const [expandedGame, setExpandedGame] = useState<string | null>(null)
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})
  const [loadingHistory, setLoadingHistory] = useState<Record<string, boolean>>({})

  // Load history when expanding
  useEffect(() => {
    if (expandedGame && !historyData[expandedGame]) {
      setLoadingHistory(prev => ({ ...prev, [expandedGame]: true }))
      
      fetch(`http://localhost:3000/api/history/${expandedGame}`)
        .then(res => res.json())
        .then(data => {
          setHistoryData(prev => ({ ...prev, [expandedGame]: data.slice(0, 10) }))
          setLoadingHistory(prev => ({ ...prev, [expandedGame]: false }))
        })
        .catch(err => {
          console.error('Failed to load history:', err)
          setLoadingHistory(prev => ({ ...prev, [expandedGame]: false }))
        })
    }
  }, [expandedGame])

  const toggleGame = (gameId: string) => {
    setExpandedGame(prev => prev === gameId ? null : gameId)
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-12">
      
      {/* Hero Section */}
      <SimulationHero />

      {/* Agent Showcase */}
      <section>
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black mb-3 text-white">Meet the Agents</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Seven autonomous AI agents with distinct personalities, competing in game theory experiments on the blockchain.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {SIMULATION_AGENTS.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </section>

      {/* Games Section */}
      <section>
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black mb-3 text-white">Choose Your Experiment</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Select a game to view its history or launch a new simulation session.
          </p>
        </div>

        <div className="grid gap-6">
          {GAMES.map((game) => {
            const isExpanded = expandedGame === game.id
            const sessions = historyData[game.id] || []
            const isLoading = loadingHistory[game.id] || false

            return (
              <div 
                key={game.id} 
                className={`card bg-base-100 shadow-xl border border-white/5 overflow-hidden transition-all duration-300 ${
                  isExpanded ? 'ring-2 ring-primary' : 'hover:scale-[1.01]'
                }`}
              >
                
                {/* Card Header */}
                <div 
                  className={`p-6 cursor-pointer bg-gradient-to-br ${game.color} flex items-center justify-between`}
                  onClick={() => toggleGame(game.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-black/30 rounded-xl backdrop-blur-md text-4xl">
                      {game.icon}
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-white">{game.name}</h3>
                      <p className="text-sm text-white/70 mt-1">{game.desc}</p>
                      
                      {/* Rules Pills */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {game.rules.map((rule, idx) => (
                          <span 
                            key={idx}
                            className="text-[10px] px-2 py-1 rounded-full bg-white/10 text-white/70 uppercase font-bold tracking-wider"
                          >
                            {rule}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="p-6 bg-base-100 border-t border-white/5 animate-in slide-in-from-top-2">
                    
                    <div className="flex justify-between items-center mb-6">
                      <h4 className="font-bold uppercase text-xs tracking-wider opacity-50 flex items-center gap-2">
                        <Brain size={14} /> Session History
                      </h4>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/simulation/run/${game.id}`)
                        }}
                        className="btn btn-primary btn-sm gap-2"
                      >
                        <Play size={16} /> Start New Simulation
                      </button>
                    </div>

                    {/* Session History */}
                    <SessionHistoryList 
                      sessions={sessions}
                      loading={isLoading}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}