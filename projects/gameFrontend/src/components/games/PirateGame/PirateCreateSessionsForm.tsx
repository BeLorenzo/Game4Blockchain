import React, { useState } from 'react'

// Costante MBR per inizializzazione contratto con Box Storage (stima standard)
// In un'implementazione avanzata, questo valore verrebbe passato come prop dopo una simulazione
const NEW_GAME_MBR = 0.3791 

export interface CreateSessionParams {
  fee: number
  maxPirates: number
  regDuration: number
  commitDuration: number
  revealDuration: number
  totalCost: number
}

interface PirateCreateSessionFormProps {
  currentRound: number
  onCreate: (params: CreateSessionParams) => void
  isLoading: boolean
}

export const PirateCreateSessionForm: React.FC<PirateCreateSessionFormProps> = ({ currentRound, onCreate, isLoading }) => {
  // --- Form State ---
  const [fee, setFee] = useState<number>(1)
  const [maxPirates, setMaxPirates] = useState<number>(5)
  
  // Durate in round (default: 10, 20, 20)
  const [durations, setDurations] = useState({
    reg: 10,
    commit: 20,
    reveal: 20
  })

  // --- Calcoli Derivati (Preview) ---
  const startAt = currentRound + durations.reg
  const endCommitAt = startAt + durations.commit
  const endRevealAt = endCommitAt + durations.reveal
  
  // Costo Totale = Fee di Partecipazione (pot iniziale) + MBR (costo storage)
  const totalCost = fee + NEW_GAME_MBR

  // --- Validazione ---
  const isValid = 
    fee >= 1 && 
    maxPirates >= 3 && maxPirates <= 20 &&
    durations.reg > 0 && durations.commit > 0 && durations.reveal > 0

  const handleSubmit = () => {
    if (isValid) {
      onCreate({
        fee,
        maxPirates,
        regDuration: durations.reg,
        commitDuration: durations.commit,
        revealDuration: durations.reveal,
        totalCost
      })
    }
  }

  // Helper per input numerici sicuri
  const handleDurationChange = (field: keyof typeof durations, val: string) => {
    const intVal = parseInt(val)
    setDurations(prev => ({ ...prev, [field]: isNaN(intVal) ? 0 : intVal }))
  }

  return (
    <div className="bg-black/40 p-6 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md relative overflow-hidden">
      {/* Effetto Glow Decorativo */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>

      <h3 className="text-xl font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2 relative z-10">
        <span className="text-2xl">🏴‍☠️</span> Launch New Voyage
      </h3>

      <div className="space-y-6 relative z-10">
        
        {/* SEZIONE 1: ECONOMICS & CREW */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* A. Entry Fee */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-bold text-gray-400 text-xs uppercase tracking-wider">Entry Fee (Booty)</span>
            </label>
            <div className="relative group">
              <input 
                type="number" 
                min="1"
                step="1"
                value={fee}
                onChange={(e) => setFee(parseFloat(e.target.value) || 0)}
                className="input input-bordered w-full bg-black/50 font-mono text-lg text-primary focus:shadow-[0_0_15px_rgba(64,224,208,0.2)] transition-all pl-12 focus:border-primary"
              />
              <span className="absolute left-4 top-3 text-gray-500 font-bold">A</span>
            </div>
            <label className="label">
              <span className="label-text-alt text-gray-500 font-mono">Min: 1 ALGO</span>
            </label>
          </div>

          {/* B. Max Pirates (Slider) */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-bold text-gray-400 text-xs uppercase tracking-wider">
                Max Crew Size: <span className="text-white text-lg font-mono ml-2">{maxPirates}</span>
              </span>
            </label>
            <input 
              type="range" 
              min="3" 
              max="20" 
              value={maxPirates} 
              onChange={(e) => setMaxPirates(parseInt(e.target.value))}
              className="range range-primary range-sm" 
              step="1"
            />
            <div className="w-full flex justify-between text-[10px] px-1 mt-2 text-gray-500 font-mono uppercase font-bold">
              <span>3 Min</span>
              <span>10</span>
              <span>20 Max</span>
            </div>
          </div>
        </div>

        {/* SEZIONE 2: TIMING CONFIGURATION */}
        <div className="p-4 bg-white/5 rounded-xl border border-white/5">
          <h4 className="text-[10px] text-gray-500 uppercase tracking-widest mb-3 font-bold">Phase Durations (Rounds)</h4>
          
          <div className="grid grid-cols-3 gap-3 mb-4">
            {/* Reg Duration */}
            <div className="form-control">
              <label className="label p-1 justify-center"><span className="label-text text-[9px] uppercase font-bold text-blue-400">Registration</span></label>
              <input 
                type="number" min="1" value={durations.reg}
                onChange={(e) => handleDurationChange('reg', e.target.value)}
                className="input input-sm input-bordered bg-black/50 text-center font-mono focus:border-blue-500 text-white"
              />
            </div>
            {/* Commit Duration */}
            <div className="form-control">
              <label className="label p-1 justify-center"><span className="label-text text-[9px] uppercase font-bold text-yellow-500">Commit</span></label>
              <input 
                type="number" min="1" value={durations.commit}
                onChange={(e) => handleDurationChange('commit', e.target.value)}
                className="input input-sm input-bordered bg-black/50 text-center font-mono focus:border-yellow-500 text-white"
              />
            </div>
            {/* Reveal Duration */}
            <div className="form-control">
              <label className="label p-1 justify-center"><span className="label-text text-[9px] uppercase font-bold text-orange-500">Reveal</span></label>
              <input 
                type="number" min="1" value={durations.reveal}
                onChange={(e) => handleDurationChange('reveal', e.target.value)}
                className="input input-sm input-bordered bg-black/50 text-center font-mono focus:border-orange-500 text-white"
              />
            </div>
          </div>

          {/* Timeline Preview Visual */}
          <div className="bg-black/60 rounded-lg p-3 border border-white/5 relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-[calc(100%-2rem)] h-0.5 bg-gray-700/50"></div>
            
            <div className="relative flex justify-between text-[10px] font-mono z-10">
              {/* NOW */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-500 ring-4 ring-black"></div>
                <span className="text-gray-500 font-bold">NOW</span>
                <span className="text-gray-600">{currentRound}</span>
              </div>

              {/* START */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500 ring-4 ring-black shadow-[0_0_8px_blue]"></div>
                <span className="text-blue-400 font-bold">START</span>
                <span className="text-gray-400">+{durations.reg}</span>
              </div>

              {/* VOTE */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-500 ring-4 ring-black shadow-[0_0_8px_orange]"></div>
                <span className="text-yellow-500 font-bold">VOTE</span>
                <span className="text-gray-400">+{durations.commit}</span>
              </div>

              {/* END */}
              <div className="flex flex-col items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500 ring-4 ring-black shadow-[0_0_8px_green]"></div>
                <span className="text-green-500 font-bold">END</span>
                <span className="text-gray-400">+{durations.reveal}</span>
              </div>
            </div>
          </div>
        </div>

        {/* SEZIONE 3: COST SUMMARY & ACTION */}
        <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5">
          <div className="flex flex-col">
            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Total Cost (Fee + MBR)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white">{totalCost.toFixed(4)}</span>
              <span className="text-xs font-mono text-primary">ALGO</span>
            </div>
            <span className="text-[9px] text-gray-600 font-mono">
              Includes {NEW_GAME_MBR} A storage deposit
            </span>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!isValid || isLoading}
            className="btn btn-primary btn-md px-8 font-black tracking-widest text-black shadow-[0_0_20px_rgba(64,224,208,0.3)] hover:scale-105 transition-transform"
          >
            {isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              'CREATE'
            )}
          </button>
        </div>

      </div>
    </div>
  )
}