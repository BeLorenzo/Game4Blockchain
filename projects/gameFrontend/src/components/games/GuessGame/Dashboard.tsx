/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useGuessGame, GameSession } from '../../../hooks/useGuessGame'
import { useWallet } from '@txnlab/use-wallet-react'
import { usePlayerStats } from '../../../hooks/usePlayerStats' // <--- Importa Hook

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
  const { totalProfit } = usePlayerStats(activeAddress) // <--- Usa Hook (Qui coincidente col globale)

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

  return (
    <div className="space-y-6">
      {/* 1. SEZIONE CREAZIONE + STATS GIOCO */}
      <div className="bg-base-100 p-4 rounded-xl border border-base-content/10 shadow-sm">
        <div className="flex flex-wrap justify-between items-center mb-4">
          <h4 className="font-bold text-sm uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            Nuova Partita
          </h4>

          <div className="flex items-center gap-3">
            {/* STATS SPECIFICHE DEL GIOCO */}
            {activeAddress && (
              <div className={`badge ${totalProfit >= 0 ? 'badge-success' : 'badge-error'} badge-outline font-mono font-bold`}>
                P&L: {totalProfit > 0 ? '+' : ''}
                {totalProfit.toFixed(2)} A
              </div>
            )}
            <div className="badge badge-ghost text-xs font-mono opacity-50">MBR: {mbrs.create.toFixed(3)} A</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <label className="form-control w-full">
            <div className="label">
              <span className="label-text text-[10px]">Fee (A)</span>
            </div>
            <input
              type="number"
              value={newConfig.fee}
              min={0.1}
              step={0.1}
              onChange={(e) => setNewConfig({ ...newConfig, fee: parseFloat(e.target.value) })}
              className="input input-sm input-bordered w-full font-mono"
            />
          </label>
          <label className="form-control w-full">
            <div className="label">
              <span className="label-text text-[10px]">Inizio (Round)</span>
            </div>
            <input
              type="number"
              value={newConfig.start}
              onChange={(e) => setNewConfig({ ...newConfig, start: parseInt(e.target.value) })}
              className="input input-sm input-bordered w-full font-mono"
            />
          </label>
          <label className="form-control w-full">
            <div className="label">
              <span className="label-text text-[10px]">Durata Commit</span>
            </div>
            <input
              type="number"
              value={newConfig.commit}
              onChange={(e) => setNewConfig({ ...newConfig, commit: parseInt(e.target.value) })}
              className="input input-sm input-bordered w-full font-mono"
            />
          </label>
          <label className="form-control w-full">
            <div className="label">
              <span className="label-text text-[10px]">Durata Reveal</span>
            </div>
            <input
              type="number"
              value={newConfig.reveal}
              onChange={(e) => setNewConfig({ ...newConfig, reveal: parseInt(e.target.value) })}
              className="input input-sm input-bordered w-full font-mono"
            />
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

      {/* ... (IL RESTO DEL CODICE TABS E LISTA RIMANE UGUALE) ... */}
      {/* 2. TABS & FILTRI */}
      <div className="flex flex-col xl:flex-row justify-between items-center gap-4 bg-base-200/30 p-2 rounded-xl">
        <div role="tablist" className="tabs tabs-boxed bg-transparent p-0 gap-2">
          <a
            role="tab"
            className={`tab ${activeTab === 'active' ? 'tab-active bg-primary text-primary-content' : ''}`}
            onClick={() => setActiveTab('active')}
          >
            Attive
          </a>
          <a role="tab" className={`tab ${activeTab === 'history' ? 'tab-active' : ''}`} onClick={() => setActiveTab('history')}>
            Storico
          </a>
          <a
            role="tab"
            className={`tab ${activeTab === 'mine' ? 'tab-active bg-accent text-accent-content' : ''}`}
            onClick={() => setActiveTab('mine')}
          >
            I Miei Giochi
          </a>
        </div>

        <div className="join scale-90">
          <input
            className="join-item btn btn-sm btn-ghost"
            type="radio"
            aria-label="Tutti"
            checked={phaseFilter === 'ALL'}
            onChange={() => setPhaseFilter('ALL')}
          />
          <input
            className="join-item btn btn-sm btn-ghost"
            type="radio"
            aria-label="Attesa"
            checked={phaseFilter === 'WAITING'}
            onChange={() => setPhaseFilter('WAITING')}
          />
          <input
            className="join-item btn btn-sm btn-ghost"
            type="radio"
            aria-label="Commit"
            checked={phaseFilter === 'COMMIT'}
            onChange={() => setPhaseFilter('COMMIT')}
          />
          <input
            className="join-item btn btn-sm btn-ghost"
            type="radio"
            aria-label="Reveal"
            checked={phaseFilter === 'REVEAL'}
            onChange={() => setPhaseFilter('REVEAL')}
          />
          <input
            className="join-item btn btn-sm btn-ghost"
            type="radio"
            aria-label="Ended"
            checked={phaseFilter === 'ENDED'}
            onChange={() => setPhaseFilter('ENDED')}
          />
        </div>
      </div>

      {/* 3. LISTA SESSIONI */}
      <div className="space-y-3 min-h-[150px]">
        {isInitializing && <div className="loading loading-spinner mx-auto block text-primary"></div>}

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
          <div className="text-center py-10 opacity-30 font-mono text-sm border-2 border-dashed border-base-content/20 rounded-xl">
            NESSUNA SESSIONE TROVATA
          </div>
        )}
      </div>
    </div>
  )
}

const SessionItem = ({ session, loading, input, onInputChange, onJoin, onReveal, onClaim }: any) => {
  const getPhaseEndInfo = () => {
    switch (session.phase) {
      case 'WAITING':
        return `Start: ${session.rounds.start}`
      case 'COMMIT':
        return `End Commit: ${session.rounds.endCommit}`
      case 'REVEAL':
        return `End Reveal: ${session.rounds.endReveal}`
      case 'ENDED':
        return 'Terminata'
      default:
        return ''
    }
  }

  const claimStyle = session.canClaim && !session.claimResult ? 'border-accent shadow-accent/20 bg-accent/5' : 'border-base-content/5'

  return (
    <div
      className={`collapse collapse-arrow bg-base-100 border shadow-sm ${claimStyle} ${
        session.phase === 'ENDED' && !session.canClaim ? 'opacity-80' : ''
      }`}
    >
      <input type="checkbox" />

      <div className="collapse-title p-4 pr-10">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-xl opacity-40">#{session.id}</span>
            <div
              className={`badge badge-sm font-bold ${
                session.phase === 'COMMIT'
                  ? 'badge-primary'
                  : session.phase === 'REVEAL'
                    ? 'badge-warning'
                    : session.phase === 'WAITING'
                      ? 'badge-info'
                      : 'badge-ghost'
              }`}
            >
              {session.phase}
            </div>

            {session.canClaim && !session.claimResult && (
              <div className="badge badge-accent badge-sm animate-pulse font-bold">DA RISCATTARE</div>
            )}
          </div>
          <div className="text-right">
            <div className="font-bold text-lg">
              {session.totalPot.toFixed(1)} <span className="text-[10px]">ALGO</span>
            </div>
            <div className="text-xs opacity-50 font-mono">Players: {session.playersCount}</div>
          </div>
        </div>

        <div className="flex justify-between text-[10px] font-mono opacity-50 w-full px-1">
          <span>Round: {session.rounds.current}</span>
          <span className="text-right font-bold">{getPhaseEndInfo()}</span>
        </div>
        <progress
          className="progress progress-primary w-full h-1 mt-1 opacity-30"
          value={Math.max(0, session.rounds.current - session.rounds.start)}
          max={session.rounds.endReveal - session.rounds.start}
        ></progress>
      </div>

      <div className="collapse-content">
        <div className="pt-2 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] uppercase opacity-60 font-mono bg-base-200/50 p-2 rounded tracking-wide">
            <div>
              Start: <span className="text-base-content font-bold">{session.rounds.start}</span>
            </div>
            <div>
              End Commit: <span className="text-base-content font-bold">{session.rounds.endCommit}</span>
            </div>
            <div>
              End Reveal: <span className="text-base-content font-bold">{session.rounds.endReveal}</span>
            </div>
            <div>
              Fee: <span className="text-base-content font-bold">{session.fee} A</span>
            </div>
          </div>

          {(session.phase === 'REVEAL' || session.phase === 'ENDED') && session.playersCount > 0 && (
            <div className="grid grid-cols-2 gap-2 bg-base-200 p-3 rounded-lg border border-base-content/5 relative overflow-hidden">
              <div className="text-center z-10">
                <div className="text-[10px] uppercase opacity-50 font-bold">Media</div>
                <div className="text-xl font-mono">{session.gameStats.average.toFixed(2)}</div>
              </div>
              <div className="text-center z-10">
                <div className="text-[10px] uppercase opacity-50 font-bold">Target (2/3)</div>
                <div className="text-xl font-mono font-bold text-primary">{Math.round(session.gameStats.target)}</div>
              </div>
            </div>
          )}

          {session.hasPlayed && (
            <div className="alert alert-info text-xs py-3 shadow-sm flex flex-col gap-1 items-start">
              <div className="flex justify-between w-full items-center">
                <span>
                  La tua mossa: <strong className="text-lg ml-1">{session.myGuess}</strong>
                </span>
                {session.hasRevealed && <div className="badge badge-xs badge-success">Rivelato</div>}
              </div>

              {session.claimResult && (
                <div
                  className={`mt-2 p-2 rounded w-full text-center font-black uppercase tracking-widest ${
                    session.claimResult.amount >= 0 ? 'bg-success text-success-content' : 'bg-error/20 text-error'
                  }`}
                >
                  {session.claimResult.amount >= 0
                    ? `🏆 HAI VINTO +${session.claimResult.amount} A`
                    : session.claimResult.isTimeout
                      ? `⏱️ TEMPO SCADUTO - NON RIVELATO (${session.claimResult.amount} A)`
                      : `💀 HAI PERSO (${session.claimResult.amount} A)`}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-base-content/5">
            {session.canReveal && (
              <button className="btn btn-sm btn-warning w-full md:w-auto" onClick={onReveal} disabled={loading}>
                RIVELA ({session.myGuess})
              </button>
            )}

            {session.canClaim && !session.claimResult && (
              <button
                className="btn btn-sm btn-accent w-full md:w-auto font-bold animate-pulse shadow-lg shadow-accent/40"
                onClick={onClaim}
                disabled={loading}
              >
                RITIRA ORA
              </button>
            )}

            {session.phase === 'COMMIT' && !session.hasPlayed && (
              <div className="join w-full justify-end">
                <input
                  className="join-item input input-sm input-bordered w-20 font-mono"
                  type="number"
                  placeholder="0-100"
                  value={input}
                  onChange={(e: any) => onInputChange(e.target.value)}
                />
                <button className="join-item btn btn-sm btn-primary" onClick={onJoin} disabled={loading || !input}>
                  JOIN
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
