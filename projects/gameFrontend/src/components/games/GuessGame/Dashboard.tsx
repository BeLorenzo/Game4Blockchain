import React, { useState } from 'react'
import { useGuessGame, GameSession } from '../../../hooks/useGuessGame'
import { useWallet } from '@txnlab/use-wallet-react'

export const GuessGameDashboard = () => {
  const { activeSessions, historySessions, mbrs, loading, isInitializing, createSession, joinSession, revealMove } = useGuessGame()
  const { activeAddress } = useWallet()
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')

  const [newConfig, setNewConfig] = useState({ fee: 1, start: 5, commit: 50, reveal: 50 })
  const [inputs, setInputs] = useState<Record<number, string>>({})

  return (
    <div className="space-y-6">

      {/* 1. SEZIONE CREAZIONE */}
      <div className="bg-base-100 p-4 rounded-xl border border-base-content/10 shadow-sm">
        <div className="flex flex-wrap justify-between items-center mb-4">
          <h4 className="font-bold text-sm uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            Crea Nuova Partita
          </h4>
          <div className="badge badge-warning badge-outline text-xs font-mono">
            MBR Richiesto: {mbrs.create > 0 ? mbrs.create.toFixed(3) : '...'} A
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <label className="form-control w-full">
            <div className="label"><span className="label-text text-[10px]">Fee (ALGO)</span></div>
            <input type="number" value={newConfig.fee} min={0.1} step={0.1}
              onChange={e => setNewConfig({...newConfig, fee: parseFloat(e.target.value)})}
              className="input input-sm input-bordered w-full font-mono" />
          </label>
          <label className="form-control w-full">
            <div className="label"><span className="label-text text-[10px]">Start In</span></div>
            <input type="number" value={newConfig.start}
              onChange={e => setNewConfig({...newConfig, start: parseInt(e.target.value)})}
              className="input input-sm input-bordered w-full font-mono" />
          </label>
          <label className="form-control w-full">
            <div className="label"><span className="label-text text-[10px]">Commit Len</span></div>
            <input type="number" value={newConfig.commit}
              onChange={e => setNewConfig({...newConfig, commit: parseInt(e.target.value)})}
              className="input input-sm input-bordered w-full font-mono" />
          </label>
          <label className="form-control w-full">
            <div className="label"><span className="label-text text-[10px]">Reveal Len</span></div>
            <input type="number" value={newConfig.reveal}
              onChange={e => setNewConfig({...newConfig, reveal: parseInt(e.target.value)})}
              className="input input-sm input-bordered w-full font-mono" />
          </label>
          <button
            className="btn btn-sm btn-primary w-full"
            disabled={loading || !activeAddress || mbrs.create === 0}
            onClick={() => createSession(newConfig.fee, newConfig.start, newConfig.commit, newConfig.reveal)}
          >
            {loading ? '...' : 'CREA'}
          </button>
        </div>
      </div>

      {/* 2. TABS */}
      <div role="tablist" className="tabs tabs-boxed bg-transparent p-0 gap-2">
        <a role="tab"
           className={`tab transition-all duration-200 border border-base-content/10 rounded-lg ${activeTab === 'active' ? 'tab-active bg-primary text-primary-content shadow-md' : 'bg-base-100'}`}
           onClick={() => setActiveTab('active')}>
           Attive ({activeSessions.length})
        </a>
        <a role="tab"
           className={`tab transition-all duration-200 border border-base-content/10 rounded-lg ${activeTab === 'history' ? 'tab-active bg-neutral text-neutral-content shadow-md' : 'bg-base-100'}`}
           onClick={() => setActiveTab('history')}>
           Storico ({historySessions.length})
        </a>
      </div>

      {/* 3. LISTA SESSIONI */}
      <div className="space-y-3 min-h-[150px]">
        {isInitializing && (
           <div className="flex flex-col gap-3 animate-pulse">
             <div className="h-20 bg-base-300/50 rounded-xl w-full"></div>
             <div className="h-20 bg-base-300/50 rounded-xl w-full"></div>
           </div>
        )}

        {!isInitializing && (activeTab === 'active' ? activeSessions : historySessions).map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            loading={loading}
            input={inputs[s.id] || ''}
            onInputChange={(val) => setInputs({...inputs, [s.id]: val})}
            onJoin={() => joinSession(s.id, parseInt(inputs[s.id]), s.fee)}
            onReveal={() => revealMove(s.id)}
          />
        ))}

        {!isInitializing && (activeTab === 'active' ? activeSessions : historySessions).length === 0 && (
           <div className="text-center py-10 opacity-30 font-mono text-sm border-2 border-dashed border-base-content/20 rounded-xl">
             {activeTab === 'active' ? 'NESSUNA PARTITA ATTIVA' : 'NESSUNA PARTITA CONCLUSA'}
           </div>
        )}
      </div>
    </div>
  )
}

const SessionItem = ({ session, loading, input, onInputChange, onJoin, onReveal }: {
  session: GameSession, loading: boolean, input: string,
  onInputChange: (v: string) => void, onJoin: () => void, onReveal: () => void
}) => {
  return (
    <div className={`collapse collapse-arrow bg-base-100 border border-base-content/5 shadow-sm overflow-hidden ${session.phase === 'ENDED' ? 'opacity-60 grayscale-[0.5]' : ''}`}>
      <input type="checkbox" />

      <div className="collapse-title p-4 pr-10">
         <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
               <div className="font-mono text-2xl font-bold opacity-30">#{session.id}</div>
               <div>
                  <div className={`badge badge-sm font-bold border-0 ${
                    session.phase === 'COMMIT' ? 'bg-success text-success-content' :
                    session.phase === 'REVEAL' ? 'bg-warning text-warning-content' :
                    session.phase === 'WAITING' ? 'bg-info text-info-content' : 'bg-base-300'
                  }`}>
                    {session.phase}
                  </div>
                  <div className="text-[10px] opacity-60 mt-1 font-mono">
                    Round: {session.rounds.current}
                  </div>
               </div>
            </div>

            <div className="text-right">
               <div className="font-bold text-lg">{session.totalPot.toFixed(1)} <span className="text-[10px]">ALGO</span></div>
               <div className="text-xs opacity-60">Players: {session.players}</div>
            </div>
         </div>

         <progress className="progress progress-primary w-full h-1 mt-3 opacity-30"
           value={Math.max(0, session.rounds.current - session.rounds.start)}
           max={session.rounds.endReveal - session.rounds.start}>
         </progress>
      </div>

      <div className="collapse-content bg-base-200/30">
        <div className="pt-4 pb-2 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs opacity-70 font-mono bg-base-100 p-2 rounded-lg">
             <div><span className="block opacity-50">Start</span> {session.rounds.start}</div>
             <div><span className="block opacity-50">End Commit</span> {session.rounds.endCommit}</div>
             <div><span className="block opacity-50">End Reveal</span> {session.rounds.endReveal}</div>
             <div><span className="block opacity-50">Fee</span> {session.fee} A</div>
          </div>

          <div className="flex justify-end gap-2 items-center border-t border-base-content/5 pt-3">

             {session.canReveal && (
               <div className="flex items-center gap-2 w-full">
                 <div className="alert alert-success text-xs py-1 px-3 flex-1 shadow-none">
                   <span>Hai giocato! Clicca per rivelare.</span>
                 </div>
                 <button className="btn btn-sm btn-success" onClick={onReveal} disabled={loading}>
                   RIVELA
                 </button>
               </div>
             )}

             {session.phase === 'COMMIT' && !session.hasPlayed && !session.canReveal && (
                <div className="flex gap-2 w-full max-w-sm">
                   <div className="join w-full">
                      <input
                        className="join-item input input-sm input-bordered w-full font-mono"
                        placeholder="0-100"
                        type="number"
                        value={input}
                        onChange={(e) => onInputChange(e.target.value)}
                      />
                      <button
                        className="join-item btn btn-sm btn-primary"
                        onClick={onJoin}
                        disabled={loading || !input}
                      >
                        {/* Nessun riferimento a MBR qui, solo Fee */}
                        JOIN ({session.fee} A)
                      </button>
                   </div>
                </div>
             )}

             {session.hasPlayed && session.phase === 'COMMIT' && (
                <div className="badge badge-success badge-outline gap-2 p-3 w-full">
                   Mossa inviata. Attendi la fase Reveal.
                </div>
             )}

             {session.phase === 'ENDED' && <span className="opacity-50 text-xs italic">Terminata</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
