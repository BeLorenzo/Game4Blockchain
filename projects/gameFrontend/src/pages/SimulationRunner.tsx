import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Play, Square, Terminal, AlertTriangle, Activity, Skull, Crown, Brain, Zap, ArrowDown } from 'lucide-react'
import { useTransactionToast } from '../context/TransactionToast'

// =====================================================================
// INTERFACES
// =====================================================================

/**
 * Represents a single log entry in the simulation stream.
 */
interface LogEntry {
  timestamp: number
  agent: string
  type: 'thought' | 'action' | 'system' | 'game_event'
  message: string
  stateSnapshot?: GameState
  txId?: string
  txType?: string
}

/**
 * Represents the state of an individual agent in the simulation.
 */
interface AgentState {
  name?: string 
  choice?: number
  profit?: number
  status: 'waiting' | 'thinking' | 'decided' | 'eliminated'
  lastAction: string
}

/**
 * Represents the complete game state at a point in time.
 */
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

/**
 * Represents the server's simulation status.
 */
interface SimulationState {
  isRunning: boolean
  gameName: string
  sessionId: string | number
  round: number
  logs: LogEntry[]
  gameState?: GameState
}


/**
 * Color mapping for different agent names in the UI.
 */
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

const TYPING_SPEED = 15 // Milliseconds per character for typing animation
const MIN_DISPLAY_TIME = 300 // Minimum display time for a log entry (ms)


/**
 * Formats game-specific choices into human-readable display strings.
 */
const getGameChoiceDisplay = (gameId: string | undefined, choice: number | undefined) => {
  if (choice === undefined) return null;

  switch (gameId) {
    case 'StagHunt':
      // 0 = Hare (Safe/Low reward), 1 = Stag (Risky/High reward)
      return choice === 1 ? '🦌 STAG' : '🐑 HARE';
    
    case 'WeeklyGame':
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      return days[choice] ? `📅 ${days[choice]}` : `Day ${choice}`;
    
    case 'GuessGame':
      return `🔢 Guess: ${choice}`; // Assumed to be a number between 0 and 100
      
    default:
      return `Choice: ${choice}`;
  }
};

/**
 * SimulationRunner Component
 * 
 * Real-time visualization dashboard for blockchain game simulations.
 * Displays:
 * - Live agent thinking logs with typing animation
 * - Current game state (agents, pot, round)
 * - Interactive controls to start simulations
 * - Intelligent scrolling and synchronization with server state
 */
export default function SimulationRunner() {
  const { gameId } = useParams() // Get game ID from URL parameters
  const { showToast } = useTransactionToast()
  const [serverStatus, setServerStatus] = useState<SimulationState>({
    isRunning: false,
    gameName: '',
    sessionId: 0,
    round: 0,
    logs: []
  })
  
  /**
   * Visual game state (agents, pot, round).
   * Updated ONLY by the log processor to maintain synchronization
   * between displayed logs and visual state.
   */
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
  const logQueueRef = useRef<LogEntry[]>([]) // Queue of logs waiting to be displayed
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null) 
  const logsContainerRef = useRef<HTMLDivElement>(null) 
  const logsEndRef = useRef<HTMLDivElement>(null) 
  const lastSeenLogCountRef = useRef(0) 
  const isProcessingRef = useRef(false) 

  const lastToastedIdRef = useRef<string | null>(null)

  const isPirateGame = gameId === 'PirateGame';

  useEffect(() => {
    console.log('🔄 Game changed or component mounted, resetting state')
    
    // Reset all state to initial values
    setCompletedLogs([])
    setCurrentLog(null)
    setCurrentText('')
    setGameState(null)
    logQueueRef.current = []
    isProcessingRef.current = false
    lastSeenLogCountRef.current = 0
    lastToastedIdRef.current = null
    
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


  useEffect(() => {
    if (!currentLog) return
    if (currentLog.txId && currentLog.txId !== lastToastedIdRef.current) {
        lastToastedIdRef.current = currentLog.txId
        setTimeout(() => {
            showToast({
                agentName: currentLog.agent,
                txId: currentLog.txId!,
                type: (currentLog.txType as any) || 'GENERIC'
            })
        }, 100)
    }
  }, [currentLog, showToast])


  /**
   * Checks if the user is scrolled to the bottom of the logs container.
   */
  const checkIfAtBottom = useCallback(() => {
    const container = logsContainerRef.current
    if (!container) return true
    const threshold = 10
    const isBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold
    
    setIsAtBottom(isBottom)
    setShowScrollButton(!isBottom)
    return isBottom
  }, [])

  /**
   * Smoothly scrolls to the bottom of the logs container.
   */
  const scrollToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setIsAtBottom(true)
    setShowScrollButton(false)
  }, [])

  // Attach scroll event listener to logs container
  useEffect(() => {
    const container = logsContainerRef.current
    if (!container) return
    const handleScroll = () => checkIfAtBottom()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [checkIfAtBottom])

  // Auto-scroll when new logs arrive and user is at bottom
  useEffect(() => {
    if (isAtBottom) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [completedLogs.length, currentText, isAtBottom])

  /**
   * Processes the next log in the queue with typing animation.
   * 
   * Key responsibilities:
   * 1. Animates log message character by character
   * 2. Merges state snapshots into current game state
   * 3. Maintains synchronization between logs and visual state
   */
  const processNextLog = useCallback(() => {
  if (isProcessingRef.current || logQueueRef.current.length === 0) return
  
  isProcessingRef.current = true
  const nextLog = logQueueRef.current.shift()!
  
  setCurrentLog(nextLog)
  setCurrentText('')

  // If log contains a snapshot, merge new data with existing state
  if (nextLog.stateSnapshot) {
    setGameState(prev => {
      if (!prev) return nextLog.stateSnapshot!
      
      const mergedAgents = { ...prev.agents }
      
      Object.entries(nextLog.stateSnapshot!.agents).forEach(([agentName, agentState]) => {
        mergedAgents[agentName] = {
          ...mergedAgents[agentName], 
          ...agentState, 
          name: agentName 
        }
      })
      
      return {
        ...prev,
        ...nextLog.stateSnapshot,
        agents: mergedAgents
      }
    })
  }

  let charIndex = 0
  const messageLength = nextLog.message.length
  
  let charDelay = TYPING_SPEED
  if (nextLog.type === 'system' || nextLog.type === 'game_event') {
    charDelay = 8
  }

  typingIntervalRef.current = setInterval(() => {
    if (charIndex < messageLength) {
      setCurrentText(nextLog.message.slice(0, charIndex + 1))
      charIndex++
    } else {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current)
      }
      
      setCompletedLogs(prev => [...prev, nextLog])
      setCurrentLog(null)
      setCurrentText('')
      isProcessingRef.current = false
      
      setTimeout(() => processNextLog(), MIN_DISPLAY_TIME)
    }
  }, charDelay)
}, [])

  useEffect(() => {
    /**
     * Polls server for current simulation status and new logs.
     */
    const pollServer = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/status')
        if (!res.ok) throw new Error('Server error')
        
        const data = await res.json()
        setServerReachable(true)
        
        // Prevent mixing logs from different games
        if (data.gameName && data.gameName !== gameId && data.isRunning) {
          return 
        }

        const serverLogCount = data.logs?.length || 0
        
        if (serverLogCount < lastSeenLogCountRef.current) {
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


  /**
   * Starts a new simulation session for the current game.
   * Resets all local state before making the API call.
   */
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


  /**
   * Renders a single log entry with appropriate styling.
   */
  const renderLogEntry = (log: LogEntry, isTyping: boolean, displayText?: string, index?: number) => {
    const text = displayText || log.message
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
            <button onClick={startSimulation} className="btn btn-primary btn-sm gap-2 shadow-lg shadow-primary/20">
              <Play size={16} /> Start Session
            </button>
        </div>
      </div>

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

          {/* 1. AGENT MATRIX (Redesigned) */}
          <div className="bg-[#1e1e1e] rounded-xl border border-white/10 p-4 shrink-0">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Activity size={14} /> Agent Matrix
            </h3>       
            {gameState && Object.keys(gameState.agents).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(gameState.agents).map(([agentName, agentData]) => {
                  // Pirate Game logic
                  let statusIcon = null;
                  let statusText = "";
                  let rowOpacity = "opacity-100";
                  
                  // SYNC LOG: Check if agent is currently "thinking" or typing
                  const isActing = currentLog?.agent === agentName;
                  // If agent is activ highlight
                  const activeClass = isActing ? "border-primary bg-primary/10" : "border-white/5 bg-black/30";

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
                      // Normal games: show formatted choice
                      const displayChoice = getGameChoiceDisplay(gameId, agentData.choice);
                      
                      if (displayChoice) {
                        statusText = displayChoice;
                      } else if (isActing) {
                        statusText = "Thinking...";
                      } else {
                        statusText = "Waiting...";
                      }
                  }
                  
                  return (
                    <div key={agentName} className={`flex items-center justify-between p-2 rounded border transition-colors duration-200 ${activeClass} ${rowOpacity}`}>
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${AGENT_COLORS[agentName]?.split(' ')[0] || 'bg-gray-500'} ${isActing ? 'animate-ping' : ''}`}></div>
                            <div>
                                <div className="font-bold text-sm text-white flex items-center gap-2">
                                   {agentName} {statusIcon}
                                </div>
                                {statusText && <div className={`text-[10px] uppercase ${isActing ? 'text-primary' : 'text-gray-500'}`}>{statusText}</div>}
                            </div>
                        </div>
                        <div className={`text-xs font-mono font-bold ${(agentData.profit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(agentData.profit ?? 0) > 0 ? '+' : ''}{(agentData.profit ?? 0).toFixed(1)} A
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
                    <div className="text-primary font-mono font-bold text-lg">
                      {isPirateGame ? gameState.round : 1}
                    </div>
                  </div>
                  <div className="bg-black/30 p-2 rounded border border-white/5 col-span-2">
                    <div className="text-[10px] text-gray-500 uppercase">Total Pot</div>
                    <div className="text-yellow-400 font-mono font-bold text-lg">{gameState.pot} A</div>
                  </div>
                </div>
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