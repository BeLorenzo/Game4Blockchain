import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Play, Square, Terminal, AlertTriangle, Activity } from 'lucide-react'

// --- INTERFACCE ---
interface LogEntry {
  timestamp: number
  agent: string
  type: 'thought' | 'action' | 'system' | 'game_event'
  message: string
}

interface AgentState {
  name: string
  choice?: number
  profit: number
  status: 'waiting' | 'thinking' | 'decided' | 'eliminated'
  lastAction: string
}

interface GameState {
  sessionId: string | number
  round: number
  phase: string
  agents: Record<string, AgentState>
  pot: number
  pirateData?: any
}

interface SimulationState {
  isRunning: boolean
  gameName: string
  sessionId: string | number
  round: number
  logs: LogEntry[]
  gameState?: GameState
}

// --- COLORI & UTILS ---
const AGENT_COLORS: Record<string, string> = {
  Alpha: 'text-blue-400',
  Beta: 'text-red-400',
  Gamma: 'text-yellow-400',
  Delta: 'text-gray-400',
  Epsilon: 'text-pink-400',
  Zeta: 'text-purple-400',
  Eta: 'text-orange-400',
  System: 'text-green-500 font-bold',
  Game: 'text-cyan-400 font-bold italic'
}

const TypewriterText: React.FC<{ text: string }> = ({ text }) => {
  const [displayedText, setDisplayedText] = useState('')
  useEffect(() => {
    let index = 0;
    setDisplayedText('');
    const interval = setInterval(() => {
      // Controllo di sicurezza per evitare undefined se il testo cambia rapidamente
      if (!text) return;
      setDisplayedText((prev) => prev + (text.charAt(index) || ''));
      index++;
      if (index >= text.length) clearInterval(interval);
    }, 10);
    return () => clearInterval(interval);
  }, [text]);
  return <span>{displayedText}</span>
}

export default function SimulationRunner() {
  const { gameId } = useParams()
  
  const [status, setStatus] = useState<SimulationState>({
    isRunning: false,
    gameName: '',
    sessionId: 0,
    round: 0,
    logs: []
  })
  
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [displayedLogs, setDisplayedLogs] = useState<LogEntry[]>([])
  const [isTyping, setIsTyping] = useState(false)
  
  // FIX: Trigger per forzare l'aggiornamento quando arrivano log
  const [queueTrigger, setQueueTrigger] = useState(0)
  
  const logQueueRef = useRef<LogEntry[]>([])
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [serverReachable, setServerReachable] = useState(true)

  // 1. RESET INIZIALE
  useEffect(() => {
    setStatus({ isRunning: false, gameName: '', sessionId: 0, round: 0, logs: [] })
    setDisplayedLogs([])
    logQueueRef.current = []
    setGameState(null)
  }, [gameId])

  // 2. POLLING UNIFICATO
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:3000/api/status')
        if (!res.ok) throw new Error('Server error')
        
        const data = await res.json()
        setServerReachable(true)
        
        if (data.gameName && data.gameName !== gameId && data.isRunning) {
          setStatus(prev => ({ ...prev, isRunning: false }))
          return 
        }

        // SYNC LOGICA
        const serverLogCount = data.logs ? data.logs.length : 0;
        // Importante: usiamo status.logs.length come riferimento locale per sapere cosa abbiamo già processato/visto nel server state
        const localKnownLogs = status.logs.length;

        if (serverLogCount < localKnownLogs) {
            // Server Reset
            setDisplayedLogs([]);
            logQueueRef.current = [];
            if (serverLogCount > 0) {
                logQueueRef.current.push(...data.logs);
                setQueueTrigger(prev => prev + 1); // SCATTA IL TRIGGER
            }
        } else if (serverLogCount > localKnownLogs) {
            // Nuovi log
            const newLogs = data.logs.slice(localKnownLogs);
            if (newLogs.length > 0) {
               console.log(`📥 Fetching ${newLogs.length} new logs`);
               logQueueRef.current.push(...newLogs);
               setQueueTrigger(prev => prev + 1); // SCATTA IL TRIGGER
            }
        }

        if (data.gameState) setGameState(data.gameState)

        setStatus(prev => ({
            ...prev,
            isRunning: data.isRunning,
            gameName: data.gameName,
            sessionId: data.sessionId,
            round: data.round,
            logs: data.logs // Teniamo traccia di tutto lo storico raw
        }))

      } catch (e) {
        setServerReachable(false)
      }
    }, 500)
    
    return () => clearInterval(interval)
  }, [gameId, status.logs.length]) // Dipendenza su status.logs.length per il confronto corretto

  // 3. PROCESSO DI SCRITTURA (Coda Sequenziale)
  // FIX: Aggiunto queueTrigger alle dipendenze!
  useEffect(() => {
    if (logQueueRef.current.length > 0 && !isTyping) {
      setIsTyping(true)
      const nextLog = logQueueRef.current.shift()!
      
      setDisplayedLogs(prev => [...prev, nextLog])
      
      let duration = 500; 
      if (nextLog.type === 'thought' || nextLog.type === 'action') {
          duration = Math.min(nextLog.message.length * 10, 1500); 
      } else if (nextLog.type === 'game_event') {
          duration = 1000; 
      }
      
      setTimeout(() => {
        setIsTyping(false)
      }, duration)
    }
  }, [displayedLogs, isTyping, queueTrigger]) // <--- ECCO IL FIX FONDAMENTALE

  // 4. AUTO-SCROLL
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayedLogs.length])

  // --- HANDLERS ---
  const startSimulation = async () => {
    setDisplayedLogs([])
    logQueueRef.current = []
    setGameState(null)
    
    try {
      await fetch('http://localhost:3000/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: gameId })
      })
    } catch (e) {
      alert('Failed to start.')
    }
  }

  const stopSimulation = async () => {
    await fetch('http://localhost:3000/api/stop', { method: 'POST' })
  }

  const isWrongGame = status.isRunning && status.gameName && status.gameName !== gameId

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-300 p-4 md:p-8 flex flex-col font-sans">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <Link to="/simulation" className="btn btn-circle btn-ghost btn-sm">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              {gameId} 
              {status.isRunning && status.gameName === gameId && (
                <span className="flex items-center gap-2 text-sm font-mono px-3 py-1 bg-green-500/10 rounded border border-green-500/30 text-green-400">
                  <Activity size={14} className="animate-pulse" />
                  LIVE
                </span>
              )}
            </h1>
            {!serverReachable && (
              <div className="text-xs text-red-400 mt-1 font-mono">⚠️ Server disconnected</div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {!status.isRunning || isWrongGame ? (
            <button onClick={startSimulation} className="btn btn-primary btn-sm gap-2 shadow-lg shadow-primary/20">
              <Play size={16} /> Start Session
            </button>
          ) : (
            <button onClick={stopSimulation} className="btn btn-error btn-sm gap-2">
              <Square size={16} /> Stop
            </button>
          )}
        </div>
      </div>

      {isWrongGame && (
        <div className="alert alert-warning mb-6">
          <AlertTriangle />
          <span>Server busy with <strong>{status.gameName}</strong>. Stop it first.</span>
          <button onClick={stopSimulation} className="btn btn-sm">Force Stop</button>
        </div>
      )}

      {/* MAIN CONTENT GRID */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden h-[calc(100vh-150px)]">
        
        {/* LEFT: TERMINAL (60%) */}
        <div className="flex-[6] bg-[#1e1e1e] rounded-xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
          <div className="bg-[#2d2d2d] p-3 flex items-center justify-between border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-gray-500" />
              <span className="text-xs font-mono text-gray-400">neural_link.stream</span>
            </div>
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/20"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/20"></div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4 font-mono text-sm leading-relaxed custom-scrollbar">
            {displayedLogs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
                <Play size={48} />
                <p>System Ready. Initialize Simulation.</p>
              </div>
            )}

            {displayedLogs.map((log, i) => {
              const isLast = i === displayedLogs.length - 1;
              const uniqueKey = `${log.timestamp}-${log.agent}-${i}`; 

              return (
                <div key={uniqueKey} className="group flex gap-4 animate-in fade-in slide-in-from-left-1 duration-300">
                  <span className="text-[10px] opacity-20 py-1 min-w-[60px] font-sans shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                  </span>

                  <div className="flex-1 min-w-0">
                    {log.agent !== 'System' && log.agent !== 'Game' && (
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className={`font-bold tracking-wide text-xs ${AGENT_COLORS[log.agent] || 'text-white'}`}>
                          {log.agent}
                        </span>
                        <span className="text-[9px] uppercase opacity-30 bg-white/5 px-1 rounded">
                          {log.type}
                        </span>
                      </div>
                    )}

                    <div className={`
                      break-words whitespace-pre-wrap
                      ${log.type === 'thought' ? 'text-gray-400 italic pl-3 border-l-2 border-gray-700' : ''}
                      ${log.type === 'action' ? 'text-white font-semibold bg-white/5 p-3 rounded-md border-l-4 border-primary' : ''}
                      ${log.type === 'system' ? 'text-green-500 font-bold border-y border-green-900/30 py-2 text-center' : ''}
                      ${log.type === 'game_event' ? 'text-cyan-400 font-bold py-1 pl-3 border-l-2 border-cyan-500/30' : ''}
                    `}>
                      {isLast && isTyping ? (
                        <TypewriterText text={log.message} />
                      ) : (
                        log.message
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={logsEndRef} className="h-4" />
          </div>
        </div>

        {/* RIGHT: STATUS PANELS (40%) */}
        <div className="flex-[4] flex flex-col gap-4 overflow-y-auto pr-1">
          
          {/* 1. AGENT STATUS */}
          <div className="bg-[#1e1e1e] rounded-xl border border-white/10 p-4 shrink-0">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Activity size={14} /> Agent Matrix
            </h3>
            
            {gameState && Object.keys(gameState.agents).length > 0 ? (
              <div className="space-y-2">
                {Object.values(gameState.agents).map((agent) => (
                  <div key={agent.name} className="flex items-center justify-between p-2 rounded bg-black/30 border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                         agent.status === 'thinking' ? 'bg-yellow-500 animate-pulse' :
                         agent.status === 'decided' ? 'bg-green-500' :
                         agent.status === 'eliminated' ? 'bg-red-500' : 'bg-gray-600'
                      }`}></div>
                      <div>
                        <div className={`font-bold text-sm ${AGENT_COLORS[agent.name]}`}>{agent.name}</div>
                        <div className="text-[10px] text-gray-500 uppercase">{agent.status}</div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      {agent.choice !== undefined && (
                        <div className="text-xs font-mono bg-white/5 px-2 py-0.5 rounded mb-1 inline-block">
                          Act: {agent.choice}
                        </div>
                      )}
                      <div className={`text-xs font-mono font-bold ${agent.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {agent.profit > 0 ? '+' : ''}{agent.profit.toFixed(1)} A
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-xs text-gray-600 py-8 border border-dashed border-white/5 rounded">
                Matrix Offline
              </div>
            )}
          </div>

          {/* 2. GAME STATE METRICS */}
          <div className="bg-[#1e1e1e] rounded-xl border border-white/10 p-4 shrink-0">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
              Environment Data
            </h3>
            
            {gameState ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <div className="text-[10px] text-gray-500 uppercase">Session ID</div>
                    <div className="text-white font-mono font-bold">#{gameState.sessionId}</div>
                  </div>
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <div className="text-[10px] text-gray-500 uppercase">Current Round</div>
                    <div className="text-primary font-mono font-bold text-lg">{gameState.round}</div>
                  </div>
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <div className="text-[10px] text-gray-500 uppercase">Phase</div>
                    <div className="text-white font-bold uppercase text-xs">{gameState.phase}</div>
                  </div>
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <div className="text-[10px] text-gray-500 uppercase">Total Pot</div>
                    <div className="text-yellow-400 font-mono font-bold text-lg">{gameState.pot} A</div>
                  </div>
                </div>

                {gameState.pirateData && (
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3 text-xs">
                    <div className="font-bold text-purple-400 mb-1">Contract Storage</div>
                    <pre className="text-[10px] overflow-auto max-h-32 opacity-70">
                      {JSON.stringify(gameState.pirateData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-xs text-gray-600 py-8 border border-dashed border-white/5 rounded">
                No active session
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}