/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useGuessGame, GameSession } from '../../../hooks/useGuessGame'
import { GenericGameDashboard } from '../../common/GenericGameDashboard'
import { GenericSessionItem, useSessionState } from '../../common/GenericSessionItem'
import { DigitalInput } from '../../common/DigitalInput'

/**
 * GuessGame Session Item
 * Estende GenericSessionItem con la logica specifica del GuessGame
 */
const GuessSessionItem = ({ session, loading, onJoin, onReveal, onClaim }: any) => {
  const [input, setInput] = useState('')
  const { isEnded, isRevealPhase } = useSessionState(session)

  return (
    <GenericSessionItem
      session={session}
      loading={loading}
      onReveal={onReveal}
      onClaim={onClaim}
      getMyValueLabel={(s) =>
        s.myGuess !== undefined && s.myGuess !== null ? String(s.myGuess) : '???'
      }
      phaseTextOverride={session.phase === 'ACTIVE' ? 'OPEN' : undefined}

      // Game-specific stats: Average & Target
      renderGameStats={(s, isEnded, isRevealPhase) => {
        if (!(isRevealPhase && s.playersCount > 0)) return null

        const textVal = isEnded ? 'text-gray-300' : 'text-white'

        return (
          <div
            className={`flex gap-4 p-5 rounded-xl border relative overflow-hidden group ${
              isEnded ? 'bg-gray-900/10 border-white/5' : 'bg-black border-white/10'
            }`}
          >
            {!isEnded && (
              <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            )}
            <div className="flex-1 text-center z-10">
              <div className="text-[10px] uppercase text-gray-500 font-bold tracking-[0.2em] mb-1">
                Average
              </div>
              <div className={`text-3xl font-mono ${textVal}`}>
                {s.gameStats.average.toFixed(2)}
              </div>
            </div>
            <div className="w-px bg-white/5"></div>
            <div className="flex-1 text-center z-10">
              <div className="text-[10px] uppercase text-gray-500 font-bold tracking-[0.2em] mb-1">
                Target (2/3)
              </div>
              <div
                className={`text-3xl font-mono font-black ${
                  isEnded
                    ? 'text-gray-400'
                    : 'text-primary drop-shadow-[0_0_10px_rgba(64,224,208,0.4)]'
                }`}
              >
                {Math.round(s.gameStats.target)}
              </div>
            </div>
          </div>
        )
      }}

      // Game-specific join controls
      renderJoinControls={(s, loading) => (
        <div className="w-full md:w-auto flex justify-end">
          <DigitalInput
            value={input}
            onChange={setInput}
            label="GUESS:"
            actionLabel="JOIN"
            onAction={() => onJoin(s.id, parseInt(input), s.fee)}
            disabled={loading}
            isLoading={loading}
            min={0}
            max={100}
          />
        </div>
      )}
    />
  )
}

/**
 * GuessGame Dashboard
 * Usa GenericGameDashboard con configurazione specifica
 */
export const GuessGameDashboard = () => {
  return (
    <GenericGameDashboard
      useGameHook={useGuessGame}
      SessionItemComponent={GuessSessionItem}
      defaultConfig={{ fee: 1, start: 5, commit: 50, reveal: 50 }}
      emptyStateConfig={{ icon: '🔭', message: 'No sessions found' }}
    />
  )
}
