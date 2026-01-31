/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useWeeklyGame } from '../../../hooks/useWeeklyGame'
import { GenericGameDashboard } from '../../common/GenericGameDashboard'
import { GenericSessionItem } from '../../common/GenericSessionItem'
import { DigitalInput } from '../../common/DigitalInput'
import { config } from '../../../config'

const DAYS_LABEL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/**
 * WeeklyGame Session Item
 * Estende GenericSessionItem con la logica specifica del WeeklyGame
 */
const WeeklySessionItem = ({ session, loading, onJoin, onReveal, onClaim }: any) => {
  const [input, setInput] = useState('')

  return (
    <GenericSessionItem
      session={session}
      loading={loading}
      onReveal={onReveal}
      onClaim={onClaim}
      getMyValueLabel={(s) =>
        s.myDay !== undefined && s.myDay !== null ? DAYS_LABEL[s.myDay] : '???'
      }
      phaseTextOverride={session.phase === 'ACTIVE' ? 'OPEN' : undefined}

      renderGameStats={(s, isEnded, isRevealPhase) => {
        if (!(isRevealPhase && s.playersCount > 0 && s.dayCounts)) return null

        return (
          <div
            className={`mt-4 p-4 rounded-xl border ${
              isEnded ? 'bg-black/40 border-white/5' : 'bg-black border-white/10'
            }`}
          >
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-primary rounded-full"></span>
              Live Results
            </div>
            <div className="grid grid-cols-7 gap-1 h-24 items-end">
              {s.dayCounts.map((count: number, idx: number) => {
                const max = Math.max(...s.dayCounts, 1)
                const height = Math.max((count / max) * 100, 5)
                const isMyPick = s.myDay === idx

                return (
                  <div
                    key={idx}
                    className="flex flex-col items-center gap-1 group relative h-full justify-end"
                  >
                    <div className="text-[9px] font-mono text-white font-bold mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {count > 0 ? count : ''}
                    </div>
                    <div
                      style={{ height: `${height}%` }}
                      className={`w-full rounded-t-sm transition-all duration-500 relative ${
                        isMyPick
                          ? 'bg-primary shadow-[0_0_10px_rgba(64,224,208,0.5)]'
                          : count > 0
                            ? 'bg-white/20 group-hover:bg-white/40'
                            : 'bg-white/5'
                      }`}
                    >
                      {isMyPick && (
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white rounded-full"></div>
                      )}
                    </div>
                    <div
                      className={`text-[8px] md:text-[9px] font-bold tracking-tighter mt-1 ${
                        isMyPick ? 'text-primary' : 'text-gray-600'
                      }`}
                    >
                      {DAYS_LABEL[idx].substring(0, 3)}
                    </div>
                  </div>
                )
              })}
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
            label="DAY (0-6):"
            actionLabel="BUY TICKET"
            onAction={() => onJoin(s.id, s.fee, parseInt(input))}
            disabled={loading}
            isLoading={loading}
            min={0}
            max={6}
          />
        </div>
      )}
    />
  )
}

/**
 * WeeklyGame Dashboard
 * Usa GenericGameDashboard con configurazione specifica
 */
export const WeeklyGameDashboard = () => {
  return (
    <GenericGameDashboard
      useGameHook={useWeeklyGame}
      SessionItemComponent={WeeklySessionItem}
      gamePrefix="weekly"
      appId={config.games.weeklyGame.appId}
      emptyStateConfig={{ icon: '🔭', message: 'No sessions found' }}
    />
  )
}
