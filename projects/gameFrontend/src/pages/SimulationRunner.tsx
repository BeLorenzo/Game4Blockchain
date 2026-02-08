import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Play, Square, Terminal, AlertTriangle } from 'lucide-react'
import { TypewriterLog } from '../components/TypewriterLog'

interface LogEntry {
  timestamp: number
  agent: string
  type: 'thought' | 'action' | 'system' | 'game_event' // Aggiunto game_event
  message: string
}

interface SimulationState {
  isRunning: boolean
  gameName: string
  round: number
  logs: LogEntry[]
}

const AGENT_COLORS: Record<string, string> = {
  Alpha: 'text-blue-400',
  Beta: 'text-red-400',
  Gamma: 'text-yellow-400',
  Delta: 'text-gray-400',
  Epsilon: 'text-pink-400',
  Zeta: 'text-purple-400',
  Eta: 'text-orange-400',
  System: 'text-green-500 font-bold',
  Game: 'text-cyan-400 font-bold italic' // Colore per eventi di gioco
}

export default function SimulationRunner() {
  const { gameId } = useParams()
  const [status, setStatus] = useState<SimulationState>({
    isRunning: false,
    gameName: '',
    round: 0,
    logs: []
  })
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Reset iniziale
  useEffect(() => {
    setStatus({ isRunning: false, gameName: '', round: 0, logs: [] })
  }, [gameId])

  // Polling e Sync
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:3000/api/status')
        const data = await res.json()
        
        if (data.gameName && data.gameName !== gameId && data.isRunning) {
             setStatus(prev => ({ ...prev, isRunning: false })); 
        } else {
             // Aggiorniamo solo se ci sono nuovi log per evitare re-render inutili
             setStatus(prev => {
                if (prev.logs.length === data.logs.length) return prev;
                return data;
             })
        }
      } catch (e) { console.error("Server offline") }
    }, 500) // Polling più veloce (500ms) per reattività
    return () => clearInterval(interval)
  }, [gameId])

  // Auto-scroll
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [status.logs.length])

  const startSimulation = async () => {
    setStatus(prev => ({ ...prev, logs: [] })) 
    await fetch('http://localhost:3000/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: gameId })
    })
  }

  const stopSimulation = async () => {
    await fetch('http://localhost:3000/api/stop', { method: 'POST' })
  }

  const isWrongGame = status.isRunning && status.gameName && status.gameName !== gameId;

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
              {gameId} <span className="text-primary text-sm font-mono px-2 py-1 bg-primary/10 rounded">LIVE SESSION</span>
            </h1>
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

      {/* TERMINALE */}
      <div className="flex-1 bg-[#1e1e1e] rounded-xl border border-white/10 shadow-2xl flex flex-col overflow-hidden relative">
        <div className="bg-[#2d2d2d] p-3 flex items-center justify-between border-b border-white/5">
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
        
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar font-mono text-sm leading-relaxed">
          {(!status.isRunning && status.logs.length === 0) && (
            <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
              <Play size={48} />
              <p>Awaiting initialization...</p>
            </div>
          )}

          {status.logs.map((log, i) => (
            <div key={i} className="group flex gap-4">
               {/* Timestamp */}
               <span className="text-[10px] opacity-20 py-1 min-w-[60px] font-sans">
                  {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                </span>

               <div className="flex-1">
                  {/* Header (Nome Agente) */}
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

                  {/* Messaggio */}
                  <div className={`
                    ${log.type === 'thought' ? 'text-gray-400 italic pl-3 border-l-2 border-gray-700' : ''}
                    ${log.type === 'action' ? 'text-white font-semibold bg-white/5 p-3 rounded-md border-l-4 border-primary' : ''}
                    ${log.type === 'system' ? 'text-green-500 font-bold border-y border-green-900/30 py-2 text-center' : ''}
                    ${log.type === 'game_event' ? 'text-cyan-300 font-bold py-1 pl-4 border-l border-cyan-500/30' : ''}
                  `}>
                    {/* TRUCCO PER EFFETTO FLUIDO: 
                       Usiamo SEMPRE TypewriterLog. 
                       speed={75} è una buona via di mezzo (più alto = più veloce in react-type-animation).
                       Non passiamo 'cursor' a tutti, ma solo all'ultimo.
                    */}
                    <TypewriterLog 
                        text={log.message} 
                    />
                  </div>
               </div>
            </div>
          ))}
          <div ref={logsEndRef} className="h-4" />
        </div>
      </div>
    </div>
  )
}