/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useRPS } from '../../../hooks/useRPS'
import { useWallet } from '@txnlab/use-wallet-react'
import { GenericGameDashboard } from '../../common/GenericGameDashboard'
import { GenericSessionItem,  } from '../../common/GenericSessionItem'
import { ellipseAddress } from '../../../utils/ellipseAddress'
import { config } from '../../../config'

const MOVES = [
  { id: 0, label: 'ROCK', icon: '🪨', border: 'border-stone-500' },
  { id: 1, label: 'PAPER', icon: '📄', border: 'border-blue-300' },
  { id: 2, label: 'SCISSORS', icon: '✂️', border: 'border-red-500' },
]

/**
 * RPS Session Item
 * Estende GenericSessionItem con la logica specifica del RPS
 */
const RPSSessionItem = ({ session, loading, onJoin, onReveal, onClaim }: any) => {
  const [selectedMove, setSelectedMove] = useState<number | null>(null)
  const { activeAddress } = useWallet()

  const isPlayer1 = session.player1 === activeAddress
  const isPlayer2 = session.player2 === activeAddress

  const getMoveLabel = (move?: number | null) => {
    if (move === undefined || move === null) return '???'
    return MOVES[move]?.label || 'UNKNOWN'
  }

  return (
    <GenericSessionItem
      session={session}
      loading={loading}
      onReveal={onReveal}
      onClaim={onClaim}
      getMyValueLabel={(s) => getMoveLabel(s.myMove)}
      phaseTextOverride={session.phase === 'ACTIVE' ? 'OPEN' : undefined}

      // Game-specific stats: Players VS display
      renderGameStats={(s) => (
        <>
          <div className="mt-6 flex justify-between px-6 py-4 bg-black/40 rounded-xl border border-white/5">
            <div className="text-center font-mono font-bold">
              {s.player1.startsWith('Wait')
                ? 'Waiting...'
                : ellipseAddress(s.player1)}
              {isPlayer1 && ' (YOU)'}
            </div>

            <div className="opacity-20 font-black text-3xl">VS</div>

            <div className="text-center font-mono font-bold">
              {s.player2.startsWith('Wait')
                ? 'Waiting...'
                : ellipseAddress(s.player2)}
              {isPlayer2 && ' (YOU)'}
            </div>
          </div>
        </>
      )}

      // Game-specific join controls: Move selection
      renderJoinControls={(s, loading) => (
        <>
          <div className="w-full grid grid-cols-3 gap-3 mb-4">
            {MOVES.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMove(m.id)}
                className={`p-3 rounded-xl border-2 transition-all ${
                  selectedMove === m.id
                    ? `${m.border} bg-white/10 scale-105`
                    : 'border-white/5 opacity-50 hover:opacity-100'
                }`}
              >
                <div className="text-3xl">{m.icon}</div>
                <div className="text-xs font-bold mt-1">{m.label}</div>
              </button>
            ))}
          </div>

          <button
            className="btn btn-primary font-black w-full md:w-auto"
            disabled={selectedMove === null || loading}
            onClick={() => selectedMove !== null && onJoin(s.id, selectedMove, s.fee)}
          >
            FIGHT ({s.fee} A)
          </button>
        </>
      )}
    />
  )
}

/**
 * RPS Dashboard
 * Usa GenericGameDashboard con configurazione specifica
 */
export const RPSDashboard = () => {
  return (
    <GenericGameDashboard
      useGameHook={useRPS}
      SessionItemComponent={RPSSessionItem}
      gamePrefix="rps"
      appId={config.games.rps.appId}
      emptyStateConfig={{ icon: '⚔️', message: 'No battles found' }}
    />
  )
}
