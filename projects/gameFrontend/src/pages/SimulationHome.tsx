import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, ChevronDown, ChevronUp, History, Brain, Trophy } from 'lucide-react'

// Definizione dei giochi
const GAMES = [
  { id: 'StagHunt', name: 'Stag Hunt', desc: 'Dilemma della cooperazione. Caccia al Cervo (Rischio) o alla Lepre (Sicurezza)?', color: 'from-green-500/20 to-emerald-500/5' },
  { id: 'PirateGame', name: 'Pirate Game', desc: 'Teoria dei giochi multi-round. Negoziazione, votazioni e tradimenti per il bottino.', color: 'from-red-500/20 to-orange-500/5' },
  { id: 'WeeklyGame', name: 'Weekly Lottery', desc: 'Gioco di minoranza. Vince chi sceglie il giorno meno affollato.', color: 'from-blue-500/20 to-cyan-500/5' },
  { id: 'GuessGame', name: 'Beauty Contest', desc: 'Indovina 2/3 della media. Un test di gerarchia cognitiva.', color: 'from-purple-500/20 to-indigo-500/5' },
]

export default function SimulationHome() {
  const navigate = useNavigate()
  const [expandedGame, setExpandedGame] = useState<string | null>(null)
  const [historyData, setHistoryData] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Carica lo storico quando si espande una card
  useEffect(() => {
    if (expandedGame) {
      setLoadingHistory(true)
      fetch(`http://localhost:3000/api/history/${expandedGame}`)
        .then(res => res.json())
        .then(data => {
            setHistoryData(data.slice(0, 5)); // Mostra solo le ultime 5 sessioni
            setLoadingHistory(false)
        })
        .catch(() => setLoadingHistory(false))
    }
  }, [expandedGame])

  const toggleGame = (gameId: string) => {
    if (expandedGame === gameId) setExpandedGame(null)
    else setExpandedGame(gameId)
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-black mb-4 bg-clip-text text-transparent bg-gradient-to-r from-accent to-primary">
          AI SIMULATION LAB
        </h1>
        <p className="text-xl opacity-60 max-w-2xl mx-auto">
          Osserva 7 agenti autonomi competere sulla blockchain. Analizza i loro processi decisionali in tempo reale.
        </p>
      </div>

      <div className="grid gap-6">
        {GAMES.map((game) => (
          <div key={game.id} className={`card bg-base-100 shadow-xl border border-white/5 overflow-hidden transition-all duration-300 ${expandedGame === game.id ? 'ring-2 ring-primary' : 'hover:scale-[1.01]'}`}>
            
            {/* CARD HEADER (Cliccabile) */}
            <div 
                className={`p-6 cursor-pointer bg-gradient-to-br ${game.color} flex items-center justify-between`}
                onClick={() => toggleGame(game.id)}
            >
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-black/30 rounded-xl backdrop-blur-md">
                        <Brain className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-white">{game.name}</h3>
                        <p className="text-sm text-white/70">{game.desc}</p>
                    </div>
                </div>
                {expandedGame === game.id ? <ChevronUp /> : <ChevronDown />}
            </div>

            {/* EXPANDED CONTENT */}
            {expandedGame === game.id && (
              <div className="p-6 bg-base-100 border-t border-white/5 animate-in slide-in-from-top-2">
                
                <div className="flex justify-between items-center mb-6">
                    <h4 className="font-bold uppercase text-xs tracking-wider opacity-50 flex items-center gap-2">
                        <History size={14} /> Recent Sessions
                    </h4>
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/simulation/run/${game.id}`);
                        }}
                        className="btn btn-primary btn-sm gap-2"
                    >
                        <Play size={16} /> Start New Simulation
                    </button>
                </div>

                {/* HISTORICAL SESSIONS LIST */}
                {loadingHistory ? (
                    <div className="flex justify-center p-4"><span className="loading loading-spinner"></span></div>
                ) : historyData.length === 0 ? (
                    <div className="text-center opacity-40 italic p-4">Nessuna sessione trovata. Avviane una!</div>
                ) : (
                    <div className="space-y-3">
                        {historyData.map((session: any, idx: number) => {
                            // Calcolo rapido vincitore (chi ha più profitto)
                            const winner = session.rounds.flat().sort((a:any, b:any) => b.profit - a.profit)[0];
                            return (
                                <div key={idx} className="bg-base-200 p-4 rounded-lg flex justify-between items-center border border-white/5">
                                    <div className="flex gap-4 items-center">
                                        <div className="badge badge-neutral">Session #{session.session}</div>
                                        <div className="text-xs opacity-50">{new Date(session.timestamp).toLocaleString()}</div>
                                    </div>
                                    {winner && (
                                        <div className="flex items-center gap-2 text-success font-bold text-sm">
                                            <Trophy size={14} /> 
                                            {winner.agent} (+{winner.profit.toFixed(1)} A)
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}