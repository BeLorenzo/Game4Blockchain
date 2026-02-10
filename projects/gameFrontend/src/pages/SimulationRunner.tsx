import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Play, Square, Terminal, AlertTriangle, Activity, Skull, Crown, Brain, Zap, ArrowDown } from 'lucide-react'

// =====================================================================
// INTERFACCE
// =====================================================================

interface LogEntry {
  timestamp: number
  agent: string
  type: 'thought' | 'action' | 'system' | 'game_event'
  message: string
  // MODIFICA: Lo snapshot arriva qui dentro
  stateSnapshot?: GameState
}

interface AgentState {
  name?: string 
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
  pirateData?: {
      captain: string;
      alivePirates?: string[];
      aliveCount: number;
  }
}

interface SimulationState {
  isRunning: boolean
  gameName: string
  sessionId: string | number
  round: number
  logs: LogEntry[]
  gameState?: GameState
}

// =====================================================================
// CONFIGURAZIONE
// =====================================================================

const AGENT_COLORS: Record<string, string> = {
  Alpha: 'text-blue-400 border-blue-500/30',
  Beta: 'text-red-400 border-red-500/30',
  Gamma: 'text-yellow-400 border-yellow-500/30',
  Delta: 'text-gray-400 border-gray-500/30',
  Epsilon: 'text-pink-400 border-pink-500/30',
  Zeta: 'text-purple-400 border-purple-500/30',
  Eta: 'text-orange-400 border-orange-500/30',
  System: 'text-green-500',
  Game: 'text-cyan-400'
}

const TYPING_SPEED = 15 
const MIN_DISPLAY_TIME = 300 

// =====================================================================
// COMPONENTE PRINCIPALE
// =====================================================================

export default function SimulationRunner() {
  const { gameId } = useParams()
  
  // --- SERVER STATE ---
  const [serverStatus, setServerStatus] = useState<SimulationState>({
    isRunning: false,
    gameName: '',
    sessionId: 0,
    round: 0,
    logs: []
  })
  
  // STATO GRAFICO (Agenti, Pot, Round)
  // Viene aggiornato SOLO dal processore dei log per mantenere la sincronia
  const [gameState, setGameState] = useState<GameState | null>(null)
  
  const [serverReachable, setServerReachable] = useState(true)

  // --- LOG RENDERING STATE ---
  const [completedLogs, setCompletedLogs] = useState<LogEntry[]>([])
  const [currentLog, setCurrentLog] = useState<LogEntry | null>(null)
  const [currentText, setCurrentText] = useState('')
  
  // --- AUTO-SCROLL STATE ---
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  
  // --- REFS ---
  const logQueueRef = useRef<LogEntry[]>([])
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const lastSeenLogCountRef = useRef(0)
  const isProcessingRef = useRef(false)

  const isPirateGame = gameId === 'PirateGame';

  // =====================================================================
  // CLEANUP COMPLETO
  // =====================================================================

  useEffect(() => {
    console.log('🔄 Game changed or component mounted, resetting state')
    
    setCompletedLogs([])
    setCurrentLog(null)
    setCurrentText('')
    setGameState(null)
    logQueueRef.current = []
    isProcessingRef.current = false
    lastSeenLogCountRef.current = 0
    
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current)
      typingIntervalRef.current = null
    }

    return () => {
      console.log('🧹 Component unmounting, cleaning up')
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current)
      }
      logQueueRef.current = []
      isProcessingRef.current = false
    }
  }, [gameId])

  // =====================================================================
  // SCROLL INTELLIGENTE
  // =====================================================================

  const checkIfAtBottom = useCallback(() => {
    const container = logsContainerRef.current
    if (!container) return true
    const threshold = 10
    const isBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold
    
    setIsAtBottom(isBottom)
    setShowScrollButton(!isBottom)
    return isBottom
  }, [])

  const scrollToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setIsAtBottom(true)
    setShowScrollButton(false)
  }, [])

  useEffect(() => {
    const container = logsContainerRef.current
    if (!container) return
    const handleScroll = () => checkIfAtBottom()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [checkIfAtBottom])

  useEffect(() => {
    if (isAtBottom) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [completedLogs.length, currentText, isAtBottom])

  // =====================================================================
  // QUEUE PROCESSOR - CUORE DELLA SINCRONIZZAZIONE
  // =====================================================================

  const processNextLog = useCallback(() => {
    if (isProcessingRef.current || logQueueRef.current.length === 0) return
    
    isProcessingRef.current = true
    const nextLog = logQueueRef.current.shift()!
    
    setCurrentLog(nextLog)
    setCurrentText('')

    // === SINCRONIZZAZIONE STATO ===
    // Se il log contiene uno snapshot, aggiorniamo la grafica ADESSO.
    // Così "Agent Matrix" mostra lo stato corrispondente al testo che sta per apparire.
    if (nextLog.stateSnapshot) {
        setGameState(nextLog.stateSnapshot)
    }

    let charIndex = 0
    const messageLength = nextLog.message.length
    
    // Calcola durata dinamica basata su tipo e lunghezza
    let charDelay = TYPING_SPEED
    if (nextLog.type === 'system' || nextLog.type === 'game_event') {
      charDelay = 8 // Più veloce per messaggi di sistema
    }

    typingIntervalRef.current = setInterval(() => {
      if (charIndex < messageLength) {
        setCurrentText(nextLog.message.slice(0, charIndex + 1))
        charIndex++
      } else {
        // Scrittura completata
        if (typingIntervalRef.current) {
          clearInterval(typingIntervalRef.current)
        }
        
        setCompletedLogs(prev => [...prev, nextLog])
        setCurrentLog(null)
        setCurrentText('')
        isProcessingRef.current = false
        
        // Processa il prossimo
        setTimeout(() => processNextLog(), MIN_DISPLAY_TIME)
      }
    }, charDelay)

  }, [])

  // =====================================================================
  // POLLING SERVER
  // =====================================================================

  useEffect(() => {
    const pollServer = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/status')
        if (!res.ok) throw new Error('Server error')
        
        const data = await res.json()
        setServerReachable(true)
        
        if (data.gameName && data.gameName !== gameId && data.isRunning) {
          return 
        }

        // NOTA IMPORTANTE:
        // Qui NON facciamo setGameState(data.gameState).
        // Ignoriamo lo stato "live" perché è troppo avanti nel futuro rispetto ai log.
        // Lo stato verrà aggiornato da processNextLog usando lo snapshot.

        // GESTIONE LOG: Rileva reset o nuovi log
        const serverLogCount = data.logs?.length || 0
        
        if (serverLogCount < lastSeenLogCountRef.current) {
          // SERVER RESET - Pulisci tutto
          console.log('🔄 Server reset detected, clearing queue')
          setCompletedLogs([])
          setCurrentLog(null)
          setCurrentText('')
          logQueueRef.current = []
          isProcessingRef.current = false
          if (typingIntervalRef.current) {
            clearInterval(typingIntervalRef.current)
          }
          lastSeenLogCountRef.current = 0
          
          if (serverLogCount > 0) {
            logQueueRef.current.push(...data.logs)
            processNextLog()
          }
        } else if (serverLogCount > lastSeenLogCountRef.current) {
          // NUOVI LOG
          const newLogs = data.logs.slice(lastSeenLogCountRef.current)
          logQueueRef.current.push(...newLogs)
          
          if (!isProcessingRef.current && !currentLog) {
            processNextLog()
          }
        }
        
        lastSeenLogCountRef.current = serverLogCount
        setServerStatus(data)

      } catch (e) {
        setServerReachable(false)
      }
    }

    const interval = setInterval(pollServer, 500)
    pollServer() 
    return () => clearInterval(interval)
  }, [gameId, processNextLog, currentLog])

  // =====================================================================
  // HANDLERS
  // =====================================================================

  const startSimulation = async () => {
    setCompletedLogs([])
    setCurrentLog(null)
    setCurrentText('')
    logQueueRef.current = []
    isProcessingRef.current = false
    lastSeenLogCountRef.current = 0
    setGameState(null)
    
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current)
    }
    
    try {
      await fetch('http://localhost:3000/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: gameId })
      })
    } catch (e) {
      alert('Failed to start simulation.')
    }
  }

  const stopSimulation = async () => {
    await fetch('http://localhost:3000/api/stop', { method: 'POST' })
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current)
      typingIntervalRef.current = null
    }
    if (currentLog) {
      setCompletedLogs(prev => [...prev, currentLog])
      setCurrentLog(null)
      setCurrentText('')
    }
    logQueueRef.current = []
    isProcessingRef.current = false
  }

  // =====================================================================
  // RENDER HELPERS
  // =====================================================================

  const renderLogEntry = (log: LogEntry, isTyping: boolean, displayText?: string, index?: number) => {
    const text = displayText || log.message
    // FIX KEYS: Usa l'indice se disponibile per evitare duplicati su timestamp identici
    const uniqueKey = `${log.timestamp}-${log.agent}-${index !== undefined ? index : 'typing'}`

    return (
      <div key={uniqueKey} className="group flex gap-4 animate-in fade-in slide-in-from-left-1 duration-200">
        {/* Timestamp */}
        <span className="text-[10px] opacity-20 py-1 min-w-[60px] font-sans shrink-0">
          {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
        </span>

        <div className="flex-1 min-w-0">
          {/* Agent Name */}
          {log.agent !== 'System' && log.agent !== 'Game' && (
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`font-bold tracking-wide text-xs ${AGENT_COLORS[log.agent]?.split(' ')[0] || 'text-white'}`}>
                {log.agent}
              </span>
              <span className="text-[9px] uppercase opacity-30 bg-white/5 px-1 rounded">
                {log.type}
              </span>
            </div>
          )}

          {/* Message */}
          <div className={`
            break-words whitespace-pre-wrap
            ${log.type === 'thought' ? 'text-gray-400 italic pl-3 border-l-2 border-gray-700' : ''}
            ${log.type === 'action' ? 'text-white font-semibold bg-white/5 p-3 rounded-md border-l-4 border-primary' : ''}
            ${log.type === 'system' ? 'text-green-500 font-bold border-y border-green-900/30 py-2 text-center' : ''}
            ${log.type === 'game_event' ? 'text-cyan-400 font-bold py-1 pl-3 border-l-2 border-cyan-500/30' : ''}
          `}>
            {text}
            {isTyping && <span className="animate-pulse">▊</span>}
          </div>
        </div>
      </div>
    )
  }

  const isWrongGame = serverStatus.isRunning && serverStatus.gameName && serverStatus.gameName !== gameId

  // =====================================================================
  // RENDER
  // =====================================================================

   return (
    <div className="pt-20 min-h-screen bg-[#0d1117] text-gray-300 flex flex-col font-sans">

      {/* HEADER */}
      <div className="flex justify-between items-center p-4 md:p-6 border-b border-white/5 shrink-0 bg-[#0d1117] sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <Link to="/simulation" className="btn btn-circle btn-ghost btn-sm">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              {gameId} 
              {serverStatus.isRunning && serverStatus.gameName === gameId && (
                <span className="flex items-center gap-2 text-sm font-mono px-3 py-1 bg-green-500/10 rounded border border-green-500/30 text-green-400">
                  <Activity size={14} className="animate-pulse" />
                  LIVE
                </span>
              )}
            </h1>
            {!serverReachable && (
              <div className="text-xs text-red-400 mt-1 font-mono flex items-center gap-1">
                <AlertTriangle size={12} /> Server disconnected
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {!serverStatus.isRunning || isWrongGame ? (
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
        <div className="alert alert-warning mx-4 md:mx-6 mt-4 shrink-0">
          <AlertTriangle />
          <span>Server busy with <strong>{serverStatus.gameName}</strong>. Stop it first.</span>
          <button onClick={stopSimulation} className="btn btn-sm">Force Stop</button>
        </div>
      )}

      {/* MAIN CONTENT - TWO COLUMN LAYOUT */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 md:p-6 relative">      

        {/* LEFT: TERMINAL (60%) - SCROLLABLE */}
        <div className="lg:w-[60%] flex flex-col bg-[#1e1e1e] rounded-xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Terminal Header */}
          <div className="bg-[#2d2d2d] p-3 flex items-center justify-between border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-gray-500" />
              <span className="text-xs font-mono text-gray-400">neural_link.stream</span>
            </div>
          </div>
          {/* Terminal Body - SCROLLABLE */}
          <div 
            ref={logsContainerRef}
            className="flex-1 overflow-y-auto p-6 space-y-4 font-mono text-sm leading-relaxed custom-scrollbar relative"
            style={{ maxHeight: 'calc(100vh - 250px)' }}
          >
            {completedLogs.length === 0 && !currentLog && (
              <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
                <Play size={48} />
                <p>System Ready. Initialize Simulation.</p>
              </div>
            )}

            {/* Completed Logs */}
            {completedLogs.map((log) => renderLogEntry(log, false))}

            {/* Currently Typing Log */}
            {currentLog && renderLogEntry(currentLog, true, currentText)}

            {/* Auto-scroll anchor */}
            <div ref={logsEndRef} className="h-4" />
          </div>

          {/* Scroll to Bottom Button */}
          {showScrollButton && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-6 right-6 btn btn-circle btn-primary shadow-2xl animate-bounce z-10"
              title="Scroll to bottom"
            >
              <ArrowDown size={20} />
            </button>
          )}
        </div>

        {/* RIGHT: STATUS PANELS (40%) */}
        <div className="flex-[4] flex flex-col gap-4 overflow-y-auto pr-1">       

          {/* 1. AGENT MATRIX (Rifatta) */}
          <div className="bg-[#1e1e1e] rounded-xl border border-white/10 p-4 shrink-0">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Activity size={14} /> Agent Matrix
            </h3>       
            {gameState && Object.keys(gameState.agents).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(gameState.agents).map(([agentName, agentData]) => {
                  // Logica Pirate Game
                  let statusIcon = null;
                  let statusText = "";
                  let rowOpacity = "opacity-100";

                  if (isPirateGame && gameState.pirateData) {
                      const isAlive = gameState.pirateData.alivePirates?.includes(agentName) || '';
                      const isCaptain = gameState.pirateData.captain === agentName;                     
                      if (!isAlive) {
                          statusIcon = <Skull size={14} className="text-red-500" />;
                          statusText = "DEAD";
                          rowOpacity = "opacity-40 grayscale";
                      } else if (isCaptain) {
                          statusIcon = <Crown size={14} className="text-yellow-400" />;
                          statusText = "CAPTAIN";
                      } else {
                          statusText = "CREW";
                      }
                  } else {
                      // Giochi normali: mostra scelta se disponibile
                      if (agentData.choice !== undefined) statusText = `Choice: ${agentData.choice}`;
                  }
                  return (
                    <div key={agentName} className={`flex items-center justify-between p-2 rounded bg-black/30 border border-white/5 ${rowOpacity}`}>
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${AGENT_COLORS[agentName]?.split(' ')[0] || 'bg-gray-500'}`}></div>
                            <div>
                                <div className="font-bold text-sm text-white flex items-center gap-2">
                                   {agentName} {statusIcon}
                                </div>
                                {statusText && <div className="text-[10px] text-gray-500 uppercase">{statusText}</div>}
                            </div>
                        </div>
                        <div className={`text-xs font-mono font-bold ${agentData.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {agentData.profit > 0 ? '+' : ''}{agentData.profit.toFixed(1)} A
                        </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-xs text-gray-600 py-8 border border-dashed border-white/5 rounded">
                Matrix Offline
              </div>
            )}
          </div>
          
        </div>
      </div>
      </div>
  )
}