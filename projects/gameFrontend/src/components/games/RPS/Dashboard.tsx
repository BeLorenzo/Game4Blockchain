import { useState } from 'react'
import { GameDashboardLayout } from '../../layout/GameDashboardLayout'
import { useRPS, RPSSession } from '../../../hooks/useRPS'
import { CreateGameForm } from '../../layout/CreateGameForm'
import { ellipseAddress } from '../../../utils/ellipseAddress'
import { useWallet } from '@txnlab/use-wallet-react'

// Icone per le mosse
const MOVES = [
  { id: 0, label: 'ROCK', icon: '🪨' },
  { id: 1, label: 'PAPER', icon: '📄' },
  { id: 2, label: 'SCISSORS', icon: '✂️' },
]

export const RPSDashboard = () => {
  const { createSession, joinSession, revealMove, loading, activeSessions, mbrs } = useRPS()
  const { activeAddress } = useWallet()

  // Stato per la Modale di Join
  const [selectedSession, setSelectedSession] = useState<RPSSession | null>(null)
  const [selectedMove, setSelectedMove] = useState<number | null>(null)

  const handleCreate = (fee: number, start: number, commit: number, reveal: number) => {
    createSession(fee, start, commit, reveal)
  }

  const handleJoin = async () => {
    if (selectedSession && selectedMove !== null) {
      await joinSession(selectedSession.id, selectedSession.fee, selectedMove)
      setSelectedSession(null)
      setSelectedMove(null)
    }
  }

  // Sezione Filtri (Identica a GuessGame)
  const filters = (
    <div className="flex gap-2 overflow-x-auto pb-2 xl:pb-0">
      <button className="btn btn-sm btn-active bg-white text-black border-0 font-bold">Active Sessions</button>
      <button className="btn btn-sm btn-ghost text-gray-400 font-normal">History</button>
    </div>
  )

  const stats = (
    <div className="flex items-center gap-4 text-xs font-mono text-gray-400">
      <span>🔥 Active: <span className="text-white font-bold">{activeSessions.length}</span></span>
    </div>
  )

  return (
    <GameDashboardLayout
      title="RPS BATTLEGROUND"
      stats={stats}
      filters={filters}
      createGameSection={
        <CreateGameForm
          onCreate={handleCreate}
          loading={loading}
          mbrCost={mbrs.create}
        />
      }
    >
      {/* TABELLA SESSIONI */}
      <div className="overflow-x-auto">
        <table className="table w-full text-left">
          <thead>
            <tr className="text-gray-500 border-b border-white/10 text-xs uppercase font-mono">
              <th className="bg-transparent">ID</th>
              <th className="bg-transparent">Phase</th>
              <th className="bg-transparent">Players (P1 vs P2)</th>
              <th className="bg-transparent text-right">Pot</th>
              <th className="bg-transparent text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {activeSessions.map((session) => (
              <tr key={session.id} className="border-b border-white/5 hover:bg-white/5 transition-colors font-mono text-sm">

                {/* ID */}
                <td className="font-bold text-gray-400">#{session.id}</td>

                {/* PHASE */}
                <td>
                  <span className={`badge badge-sm font-bold ${
                    session.phase === 'COMMIT' ? 'badge-primary text-black' :
                    session.phase === 'REVEAL' ? 'badge-warning text-black' : 'badge-ghost'
                  }`}>
                    {session.phase}
                  </span>
                </td>

                {/* PLAYERS (Specifico RPS: Mostra indirizzi) */}
                <td>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-black/30 px-2 py-1 rounded text-xs text-blue-300 border border-blue-900/30">
                       <span className="opacity-50">P1:</span>
                       {ellipseAddress(session.player1)}
                       {session.player1 === activeAddress && ' (YOU)'}
                    </div>
                    <span className="text-gray-600 font-black">VS</span>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${
                      session.player2.startsWith('Wait')
                        ? 'text-gray-500 border-dashed border-gray-700'
                        : 'text-red-300 bg-black/30 border-red-900/30'
                    }`}>
                       <span className="opacity-50">P2:</span>
                       {session.player2.startsWith('Wait') ? 'Waiting...' : ellipseAddress(session.player2)}
                       {session.player2 === activeAddress && ' (YOU)'}
                    </div>
                  </div>
                </td>

                {/* POT */}
                <td className="text-right font-bold text-primary">
                  {session.totalPot} <span className="text-[10px] text-gray-500">ALGO</span>
                </td>

                {/* ACTIONS */}
                <td className="text-right">
                  {/* Join Logic */}
                  {session.canJoin && (
                    <button
                      onClick={() => setSelectedSession(session)}
                      className="btn btn-xs btn-outline btn-accent font-bold"
                    >
                      FIGHT ({session.fee} A)
                    </button>
                  )}

                  {/* Reveal Logic */}
                  {session.canReveal && (
                    <button
                      onClick={() => revealMove(session.id)}
                      disabled={loading}
                      className="btn btn-xs btn-warning font-bold text-black"
                    >
                      REVEAL
                    </button>
                  )}

                  {/* Waiting State */}
                  {!session.canJoin && !session.canReveal && session.phase !== 'ENDED' && (
                    <span className="text-xs text-gray-600 italic">
                      {session.hasPlayed ? 'Waiting result...' : 'Spectating'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {activeSessions.length === 0 && (
          <div className="text-center py-12 text-gray-500 font-mono text-xs">
            No active battles found. Create one!
          </div>
        )}
      </div>

      {/* MODALE DI JOIN (Scelta Sasso/Carta/Forbice) */}
      {selectedSession && (
        <dialog className="modal modal-open bg-black/80 backdrop-blur-sm z-50">
          <div className="modal-box bg-[#111] border border-white/10">
            <h3 className="font-bold text-lg text-white mb-4">CHOOSE YOUR WEAPON</h3>
            <p className="text-xs text-gray-400 mb-6 font-mono">
              Joining Session #{selectedSession.id} • Wager: <span className="text-primary">{selectedSession.fee} ALGO</span>
            </p>

            <div className="grid grid-cols-3 gap-4 mb-6">
              {MOVES.map((move) => (
                <button
                  key={move.id}
                  onClick={() => setSelectedMove(move.id)}
                  className={`flex flex-col items-center p-4 rounded-xl border transition-all ${
                    selectedMove === move.id
                      ? 'bg-primary text-black border-primary scale-105'
                      : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <span className="text-3xl mb-2">{move.icon}</span>
                  <span className="text-[10px] font-black tracking-widest">{move.label}</span>
                </button>
              ))}
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setSelectedSession(null)}>Cancel</button>
              <button
                className="btn btn-primary px-8"
                disabled={selectedMove === null || loading}
                onClick={handleJoin}
              >
                {loading ? 'JOINING...' : 'CONFIRM JOIN'}
              </button>
            </div>
          </div>
        </dialog>
      )}

    </GameDashboardLayout>
  )
}
