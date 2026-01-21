/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useGuessGame, GameSession } from '../../../hooks/useGuessGame'
import { useWallet } from '@txnlab/use-wallet-react'
import { usePlayerStats } from '../../../hooks/usePlayerStats'

// ... (Parte Dashboard export const GuessGameDashboard ... rimane uguale fino a SessionItem) ...
// ... Se vuoi, incolla pure tutto il file sotto per non sbagliare ...

export const GuessGameDashboard = () => {
  const {
    activeSessions,
    historySessions,
    mySessions,
    mbrs,
    loading,
    isInitializing,
    createSession,
    joinSession,
    revealMove,
    claimWinnings,
  } = useGuessGame()

  const { activeAddress } = useWallet()
  const { totalProfit } = usePlayerStats(activeAddress)

  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'mine'>('active')
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'>('ALL')

  const [newConfig, setNewConfig] = useState({ fee: 1, start: 5, commit: 50, reveal: 50 })
  const [inputs, setInputs] = useState<Record<number, string>>({})

  const getDisplaySessions = () => {
    let list: GameSession[] = []
    if (activeTab === 'active') list = activeSessions
    if (activeTab === 'history') list = historySessions
    if (activeTab === 'mine') list = mySessions

    if (phaseFilter !== 'ALL') {
      list = list.filter((s) => s.phase === phaseFilter)
    }
    return list
  }

  const sessions = getDisplaySessions()

  const getTabClass = (isActive: boolean) =>
    `tab h-10 px-6 rounded-lg font-bold uppercase tracking-wider transition-all duration-200 ${
      isActive
        ? 'bg-primary text-black shadow-[0_0_15px_rgba(64,224,208,0.3)] scale-105'
        : 'text-gray-400 hover:text-white hover:bg-white/5'
    }`

  const getFilterClass = (filterName: string) =>
    `btn btn-sm border-0 font-bold ${
      phaseFilter === filterName ? 'bg-white text-black hover:bg-gray-200' : 'bg-base-300 text-gray-500 hover:bg-base-100 hover:text-white'
    }`

  return (
    <div className="space-y-8 pb-20">
      {/* 1. CREATE GAME SECTION */}
      <div className="bg-[#111] p-6 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none transition-all duration-500 group-hover:bg-primary/10"></div>

        <div className="flex flex-wrap justify-between items-center mb-8 relative z-10">
          <h4 className="font-black text-xl uppercase flex items-center gap-3 tracking-widest text-white">
            <span className="w-3 h-3 rounded-full bg-primary shadow-[0_0_10px_#40E0D0] animate-pulse"></span>
            Create New Game
          </h4>

          <div className="flex items-center gap-4">
            {activeAddress && (
              <div
                className={`px-4 py-2 rounded-lg border font-mono font-bold text-sm shadow-lg backdrop-blur-md ${
                  totalProfit >= 0 ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'
                }`}
              >
                P&L: {totalProfit > 0 ? '+' : ''}
                {totalProfit.toFixed(2)} A
              </div>
            )}
            <div className="text-xs font-mono font-bold text-gray-500 bg-black/50 px-3 py-2 rounded border border-white/5">
              MBR: {mbrs.create.toFixed(3)} A
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-5 items-end relative z-10">
          {/* INPUTS SENZA FRECCETTE GRAZIE AL CSS GLOBALE */}
          <label className="form-control w-full">
            <div className="label pt-0 pb-1">
              <span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Fee (Algo)</span>
            </div>
            <input
              type="number"
              value={newConfig.fee}
              min={0.1}
              step={0.1}
              onChange={(e) => setNewConfig({ ...newConfig, fee: parseFloat(e.target.value) })}
              className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary focus:text-primary focus:shadow-[0_0_10px_rgba(64,224,208,0.2)] text-center transition-all"
            />
          </label>
          <label className="form-control w-full">
            <div className="label pt-0 pb-1">
              <span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Start Round</span>
            </div>
            <input
              type="number"
              value={newConfig.start}
              onChange={(e) => setNewConfig({ ...newConfig, start: parseInt(e.target.value) })}
              className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary text-center transition-all"
            />
          </label>
          <label className="form-control w-full">
            <div className="label pt-0 pb-1">
              <span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Commit Duration</span>
            </div>
            <input
              type="number"
              value={newConfig.commit}
              onChange={(e) => setNewConfig({ ...newConfig, commit: parseInt(e.target.value) })}
              className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary text-center transition-all"
            />
          </label>
          <label className="form-control w-full">
            <div className="label pt-0 pb-1">
              <span className="label-text text-[11px] uppercase font-bold text-gray-500 tracking-wider">Reveal Duration</span>
            </div>
            <input
              type="number"
              value={newConfig.reveal}
              onChange={(e) => setNewConfig({ ...newConfig, reveal: parseInt(e.target.value) })}
              className="input input-md input-bordered w-full font-mono text-lg bg-black/40 focus:border-primary text-center transition-all"
            />
          </label>
          <button
            className="btn btn-md btn-primary w-full text-black font-black tracking-widest shadow-[0_0_20px_rgba(64,224,208,0.3)] hover:shadow-[0_0_30px_rgba(64,224,208,0.5)] hover:scale-[1.02] transition-all"
            disabled={loading || !activeAddress || mbrs.create === 0}
            onClick={() => createSession(newConfig.fee, newConfig.start, newConfig.commit, newConfig.reveal)}
          >
            {loading ? <span className="loading loading-dots loading-md"></span> : 'CREATE'}
          </button>
        </div>
      </div>

      {/* 2. TABS & FILTERS */}
      <div className="flex flex-col xl:flex-row justify-between items-center gap-6 bg-black/20 p-3 rounded-2xl border border-white/5">
        <div role="tablist" className="tabs tabs-boxed bg-transparent p-0 gap-3">
          <a role="tab" className={getTabClass(activeTab === 'active')} onClick={() => setActiveTab('active')}>
            Active
          </a>
          <a role="tab" className={getTabClass(activeTab === 'history')} onClick={() => setActiveTab('history')}>
            History
          </a>
          <a role="tab" className={getTabClass(activeTab === 'mine')} onClick={() => setActiveTab('mine')}>
            My Games
          </a>
        </div>

        <div className="flex gap-2 flex-wrap justify-center">
          <button className={getFilterClass('ALL')} onClick={() => setPhaseFilter('ALL')}>
            ALL
          </button>
          <button className={getFilterClass('WAITING')} onClick={() => setPhaseFilter('WAITING')}>
            WAITING
          </button>
          <button className={getFilterClass('COMMIT')} onClick={() => setPhaseFilter('COMMIT')}>
            COMMIT
          </button>
          <button className={getFilterClass('REVEAL')} onClick={() => setPhaseFilter('REVEAL')}>
            REVEAL
          </button>
          <button className={getFilterClass('ENDED')} onClick={() => setPhaseFilter('ENDED')}>
            ENDED
          </button>
        </div>
      </div>

      {/* 3. SESSIONS LIST */}
      <div className="space-y-5 min-h-[200px]">
        {isInitializing && (
          <div className="flex justify-center py-20">
            <span className="loading loading-bars loading-lg text-primary scale-150"></span>
          </div>
        )}

        {!isInitializing &&
          sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              loading={loading}
              input={inputs[s.id] || ''}
              onInputChange={(val: any) => setInputs({ ...inputs, [s.id]: val })}
              onJoin={() => joinSession(s.id, parseInt(inputs[s.id]), s.fee)}
              onReveal={() => revealMove(s.id)}
              onClaim={() => claimWinnings(s.id, s.fee)}
            />
          ))}

        {!isInitializing && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 opacity-40 border-2 border-dashed border-white/10 rounded-2xl bg-white/5">
            <div className="text-4xl mb-2">🔭</div>
            <div className="font-mono text-lg font-bold tracking-widest uppercase">No sessions found</div>
          </div>
        )}
      </div>
    </div>
  )
}

const SessionItem = ({ session, loading, input, onInputChange, onJoin, onReveal, onClaim }: any) => {
  const isTransitionRound = session.rounds.current === session.rounds.endCommit
  const smartCanReveal = session.canReveal || (isTransitionRound && session.hasPlayed)
  const smartCanJoin = session.phase === 'COMMIT' && !isTransitionRound && !session.hasPlayed
  const isLastChanceReveal = session.rounds.current === session.rounds.endReveal
  const isEnded = session.phase === 'ENDED'

  // --- LOGICA DI VALIDAZIONE INPUT ---
  // Impedisce di inserire valori < 0 o > 100
  const handleGuessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // Se vuoto, pulisci
    if (val === '') {
      onInputChange('')
      return
    }
    // Parsifica e controlla
    const num = parseInt(val)
    if (!isNaN(num)) {
      if (num >= 0 && num <= 100) {
        onInputChange(val)
      } else if (num > 100) {
        onInputChange('100') // Auto-fix al massimo
      }
    }
  }

  const getPhaseEndInfo = () => {
    switch (session.phase) {
      case 'WAITING':
        return `Start: ${session.rounds.start}`
      case 'COMMIT':
        if (isTransitionRound) return `REVEAL STARTING...`
        return `End Commit: ${session.rounds.endCommit}`
      case 'REVEAL':
        return `End Reveal: ${session.rounds.endReveal}`
      case 'ENDED':
        return 'Ended'
      default:
        return ''
    }
  }

  const cardBg = isEnded ? 'bg-[#0F0F0F] border-white/5' : 'bg-[#151515] border-white/10'
  const textDim = isEnded ? 'text-gray-500' : 'text-gray-400'
  const textVal = isEnded ? 'text-gray-300' : 'text-white'
  const badgeStyle = isEnded ? 'bg-white/5 text-gray-400 border border-white/5' : ''

  const borderClass =
    session.canClaim && !session.claimResult
      ? 'border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.15)]'
      : session.phase === 'COMMIT'
        ? 'hover:border-primary/40'
        : session.phase === 'REVEAL'
          ? 'border-warning/30 hover:border-warning/50'
          : 'border-white/5'

  return (
    <div className={`collapse collapse-arrow rounded-xl border transition-all duration-300 ${cardBg} ${borderClass}`}>
      <input type="checkbox" />

      {/* HEADER */}
      <div className="collapse-title p-5 pr-12">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4">
            <span className={`font-mono text-2xl font-black ${isEnded ? 'opacity-20 text-gray-600' : 'opacity-30 text-white'}`}>
              #{session.id}
            </span>

            <div
              className={`badge badge-lg font-bold tracking-wider border-0 px-4 py-3 ${
                isEnded
                  ? badgeStyle
                  : session.phase === 'COMMIT'
                    ? 'bg-primary text-black'
                    : session.phase === 'REVEAL'
                      ? 'bg-yellow-500 text-black animate-pulse'
                      : session.phase === 'WAITING'
                        ? 'bg-blue-400 text-black'
                        : 'bg-gray-700'
              }`}
            >
              {isTransitionRound ? 'REVEAL READY' : session.phase}
            </div>

            {session.canClaim && !session.claimResult && (
              <div className="badge badge-success badge-outline badge-lg font-bold animate-pulse shadow-lg bg-green-500/10">
                CLAIM AVAILABLE
              </div>
            )}
          </div>

          <div className="text-right">
            <div className={`font-black text-2xl ${textVal}`}>
              {session.totalPot.toFixed(1)} <span className="text-sm text-primary font-mono font-medium">ALGO</span>
            </div>
            <div className={`text-xs font-mono font-bold tracking-widest uppercase ${textDim}`}>Players: {session.playersCount}</div>
          </div>
        </div>

        <div className={`flex justify-between text-xs font-mono uppercase tracking-wide mb-2 ${textDim}`}>
          <span>
            Current Round: <span className={`${textVal} font-bold ml-1 text-sm`}>{session.rounds.current}</span>
          </span>
          <span className={`text-right font-bold ${isEnded ? 'text-gray-500' : 'text-primary'}`}>{getPhaseEndInfo()}</span>
        </div>

        <progress
          className={`progress w-full h-1.5 ${
            isEnded
              ? 'bg-gray-800 [&::-webkit-progress-value]:bg-gray-600'
              : isLastChanceReveal
                ? 'progress-error shadow-[0_0_10px_red]'
                : 'progress-primary'
          }`}
          value={Math.max(0, session.rounds.current - session.rounds.start)}
          max={session.rounds.endReveal - session.rounds.start}
        ></progress>
      </div>

      {/* BODY */}
      <div className={`collapse-content ${isEnded ? 'bg-[#0a0a0a]' : 'bg-[#1a1a1a]/50'}`}>
        <div className="pt-6 space-y-6">
          {/* Tech Grid */}
          <div
            className={`grid grid-cols-2 md:grid-cols-4 gap-4 text-xs uppercase font-mono p-4 rounded-lg border ${isEnded ? 'bg-[#050505] border-white/5' : 'bg-[#0f0f0f] border-white/5'}`}
          >
            <div className="flex flex-col gap-1">
              <span className="text-gray-500 font-bold tracking-widest text-[10px]">Start</span>
              <span className={`${textVal} font-bold text-sm`}>{session.rounds.start}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-gray-500 font-bold tracking-widest text-[10px]">End Commit</span>
              <span className={`${textVal} font-bold text-sm`}>{session.rounds.endCommit}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-gray-500 font-bold tracking-widest text-[10px]">End Reveal</span>
              <span className={`${textVal} font-bold text-sm`}>{session.rounds.endReveal}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-gray-500 font-bold tracking-widest text-[10px]">Fee</span>
              <span className="text-primary font-bold text-sm">{session.fee} A</span>
            </div>
          </div>

          {/* Stats Box */}
          {(session.phase === 'REVEAL' || session.phase === 'ENDED') && session.playersCount > 0 && (
            <div
              className={`flex gap-4 p-5 rounded-xl border relative overflow-hidden group ${isEnded ? 'bg-gray-900/10 border-white/5' : 'bg-black border-white/10'}`}
            >
              {!isEnded && (
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              )}
              <div className="flex-1 text-center z-10">
                <div className="text-[10px] uppercase text-gray-500 font-bold tracking-[0.2em] mb-1">Average</div>
                <div className={`text-3xl font-mono ${textVal}`}>{session.gameStats.average.toFixed(2)}</div>
              </div>
              <div className="w-px bg-white/5"></div>
              <div className="flex-1 text-center z-10">
                <div className="text-[10px] uppercase text-gray-500 font-bold tracking-[0.2em] mb-1">Target (2/3)</div>
                <div
                  className={`text-3xl font-mono font-black ${isEnded ? 'text-gray-400' : 'text-primary drop-shadow-[0_0_10px_rgba(64,224,208,0.4)]'}`}
                >
                  {Math.round(session.gameStats.target)}
                </div>
              </div>
            </div>
          )}

          {/* User Results */}
          {session.hasPlayed && (
            <div className="space-y-4">
              <div
                className={`flex justify-between items-center px-5 py-3 rounded-lg border ${isEnded ? 'bg-white/5 border-white/5' : 'bg-white/5 border-white/10'}`}
              >
                <span className="text-sm font-medium text-gray-400">
                  Your Guess: <strong className="text-xl ml-2 text-white font-mono">{session.myGuess}</strong>
                </span>
                {session.hasRevealed ? (
                  <div className="badge badge-success badge-sm font-bold text-black">REVEALED</div>
                ) : (
                  <div className="badge badge-warning badge-sm animate-pulse font-bold text-black">TO REVEAL</div>
                )}
              </div>

              {session.claimResult && (
                <div
                  className={`p-5 rounded-xl w-full text-center font-black uppercase tracking-widest shadow-2xl transform transition-all hover:scale-[1.01] relative z-20 opacity-100 ${
                    session.claimResult.amount >= 0
                      ? 'bg-gradient-to-br from-green-900 to-black border border-green-500 text-green-400'
                      : 'bg-gradient-to-br from-red-900 to-black border border-red-500 text-red-400'
                  }`}
                >
                  {session.claimResult.amount >= 0 ? (
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-lg text-green-500 mb-1">🏆 YOU WON</span>
                      <span className="text-4xl font-mono text-white text-shadow-sm">+{session.claimResult.amount} ALGO</span>
                    </div>
                  ) : session.claimResult.isTimeout ? (
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-sm text-red-400 opacity-80 mb-1">⏱️ TIME OUT</span>
                      <span className="text-2xl font-mono text-white">-{Math.abs(session.claimResult.amount)} ALGO</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-lg text-red-500 mb-1">💀 YOU LOST</span>
                      <span className="text-2xl font-mono text-white">-{Math.abs(session.claimResult.amount)} ALGO</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ACTIONS FOOTER */}
          <div className={`flex justify-end gap-3 pt-5 border-t ${isEnded ? 'border-white/5' : 'border-white/10'}`}>
            {/* REVEAL BUTTON */}
            {smartCanReveal && (
              <button
                className={`btn w-full md:w-auto font-black border-0 tracking-wider ${
                  isLastChanceReveal
                    ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse shadow-[0_0_20px_red]'
                    : 'bg-yellow-400 hover:bg-yellow-500 text-black shadow-[0_0_15px_rgba(250,204,21,0.4)]'
                }`}
                onClick={onReveal}
                disabled={loading}
              >
                {isLastChanceReveal ? `⚠️ LAST CHANCE (${session.myGuess})` : `REVEAL (${session.myGuess})`}
              </button>
            )}

            {/* CLAIM BUTTON */}
            {session.canClaim && !session.claimResult && (
              <button
                className="btn btn-accent w-full md:w-auto font-black text-white tracking-widest shadow-[0_0_20px_#00539C] animate-bounce-subtle border-white/20 hover:scale-105"
                onClick={onClaim}
                disabled={loading}
              >
                CLAIM PRIZE
              </button>
            )}

            {/* JOIN INPUT & BUTTON - DESIGN "CAPSULA DIGITALE" */}
            {smartCanJoin && (
              <div className="flex items-center bg-black rounded-lg border border-white/10 p-1 pl-3 transition-all duration-300 focus-within:border-primary/50 focus-within:shadow-[0_0_15px_rgba(64,224,208,0.15)] group">
                {/* Etichetta piccola */}
                <span className="text-[10px] font-bold text-gray-600 tracking-widest mr-2 group-focus-within:text-primary transition-colors">
                  GUESS:
                </span>

                {/* Input "Digitale" */}
                <input
                  className="bg-transparent w-16 text-xl font-mono font-black text-white focus:outline-none placeholder-gray-800 text-center"
                  type="number"
                  placeholder="00"
                  value={input}
                  min={0}
                  max={100}
                  onChange={handleGuessChange} // Mantiene la tua validazione
                />

                {/* Separatore Verticale */}
                <div className="h-8 w-px bg-white/10 mx-2"></div>

                {/* Bottone integrato */}
                <button
                  className="btn btn-sm btn-ghost hover:bg-primary hover:text-black text-primary font-black tracking-widest transition-all duration-200 rounded px-4"
                  onClick={onJoin}
                  disabled={loading || !input}
                >
                  JOIN
                </button>
              </div>
            )}

            {isTransitionRound && !session.hasPlayed && (
              <div className="text-xs text-red-400 font-bold flex items-center bg-red-900/10 px-4 py-2 rounded border border-red-500/20 tracking-wider">
                COMMIT CLOSED
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
