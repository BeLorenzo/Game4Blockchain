/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useStagHunt, StagHuntSession } from '../../../hooks/useStagHunt'
import { GenericGameDashboard } from '../../common/GenericGameDashboard'
import { GenericSessionItem } from '../../common/GenericSessionItem'

const CHOICES = [
  { id: 0, label: 'HARE', icon: '🐰', color: 'text-yellow-400', border: 'border-yellow-500/50', desc: 'Safe Choice' },
  { id: 1, label: 'STAG', icon: '🦌', color: 'text-purple-400', border: 'border-purple-500/50', desc: 'Team Coordination' },
]

/**
 * StagHunt Session Item
 */
const StagHuntSessionItem = ({ session, loading, onJoin, onReveal, onClaim, onResolve }: any) => {
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)

  const getChoiceLabel = (choice?: number | null) => {
    if (choice === undefined || choice === null) return '???'
    return CHOICES[choice]?.label || 'UNKNOWN'
  }

  return (
    <GenericSessionItem
      session={session}
      loading={loading}
      onReveal={onReveal}
      onClaim={onClaim}
      getMyValueLabel={(s) => getChoiceLabel(s.myChoice)}
      phaseTextOverride={session.phase === 'ACTIVE' ? 'OPEN' : undefined}

      renderGameStats={(s) => {
        // Logica per il Global Jackpot:
        const showJackpot = s.globalJackpot >= 0
        const showStats = s.gameStats.stags > 0 || s.gameStats.hares > 0
        const isEnded = s.phase === 'ENDED'

        return (
          <div className="space-y-4 mt-4">
            {/* Global Jackpot Banner */}
            {showJackpot && (
              <div className="relative overflow-hidden p-4 rounded-xl border border-yellow-500/30 bg-gradient-to-b from-yellow-500/10 to-transparent text-center">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-500/60 mb-1">
                  Contract Global Jackpot
                </div>
                <div className="text-3xl font-mono font-black text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.4)]">
                  {Number(s.globalJackpot).toFixed(2)} <span className="text-sm">ALGO</span>
                </div>
                <div className="text-[9px] text-gray-500 mt-1 italic">
                   This pool grows whenever a Hunt fails!
                </div>
              </div>
            )}

            {/* Live Stats Bar */}
            {showStats && (
              <div className={`p-4 rounded-xl border ${isEnded ? 'bg-black/40 border-white/5' : 'bg-black border-white/10'}`}>
                <div className="flex justify-between mb-3 px-1">
                   <div className="flex flex-col items-start">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Stags</span>
                      <span className="text-purple-400 font-mono font-bold text-lg">{s.gameStats.stags}</span>
                   </div>
                   <div className="flex flex-col items-end">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Hares</span>
                      <span className="text-yellow-400 font-mono font-bold text-lg">{s.gameStats.hares}</span>
                   </div>
                </div>
                <div className="h-3 bg-white/5 rounded-full overflow-hidden flex border border-white/5">
                  <div
                    className="bg-purple-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                    style={{ width: `${(s.gameStats.stags / (s.gameStats.stags + s.gameStats.hares)) * 100}%` }}
                  />
                  <div
                    className="bg-yellow-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(234,179,8,0.5)]"
                    style={{ width: `${(s.gameStats.hares / (s.gameStats.stags + s.gameStats.hares)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Success/Fail Banner */}
            {s.gameStats.resolved && (
               <div className={`p-4 rounded-xl border-2 text-center font-black tracking-tighter ${
                 s.gameStats.successful ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-red-500/10 border-red-500/50 text-red-400'
               }`}>
                 {s.gameStats.successful ? '🏆 HUNT SUCCESSFUL' : '💀 HUNT FAILED'}
                 {s.gameStats.rewardPerStag > 0 && (
                   <div className="text-xs mt-1 font-mono font-medium text-white/70 tracking-normal">
                     Reward: +{s.gameStats.rewardPerStag.toFixed(2)} ALGO / Stag
                   </div>
                 )}
               </div>
            )}

            {/* Resolve Button */}
            {session.canResolve && !s.gameStats.resolved && (
              <button
                onClick={() => onResolve(s.id)}
                disabled={loading}
                className="btn btn-warning btn-block font-black tracking-widest shadow-[0_0_15px_rgba(250,204,21,0.2)]"
              >
                {loading ? <span className="loading loading-dots"></span> : 'RESOLVE HUNT'}
              </button>
            )}
          </div>
        )
      }}

      renderJoinControls={(s, loading) => (
        <div className="flex flex-col items-center gap-6 mt-4">
          <div className="grid grid-cols-2 gap-4 w-full max-w-md mx-auto">
            {CHOICES.map((choice) => (
              <button
                key={choice.id}
                onClick={() => setSelectedChoice(choice.id)}
                className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-300 ${
                  selectedChoice === choice.id
                    ? `${choice.border} bg-white/10 scale-105 shadow-[0_0_25px_rgba(255,255,255,0.1)]`
                    : 'border-white/5 bg-transparent hover:border-white/20'
                }`}
              >
                <span className={`text-5xl mb-3 transition-transform duration-300 group-hover:scale-110 ${selectedChoice === choice.id ? 'filter drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]' : ''}`}>
                  {choice.icon}
                </span>
                <span className={`text-sm font-black tracking-widest ${selectedChoice === choice.id ? 'text-white' : 'text-gray-500'}`}>
                  {choice.label}
                </span>
                <span className="text-[9px] text-gray-600 mt-1 uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                  {choice.desc}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              if (selectedChoice !== null) {
                onJoin(s.id, selectedChoice, s.fee)
                setSelectedChoice(null)
              }
            }}
            disabled={selectedChoice === null || loading}
            className="btn btn-primary btn-wide font-black text-black tracking-[0.2em] shadow-[0_0_20px_rgba(64,224,208,0.4)]"
          >
            {loading ? <span className="loading loading-ring"></span> : `CONFIRM HUNT`}
          </button>
        </div>
      )}
    />
  )
}

export const StagHuntDashboard = () => {
  return (
    <GenericGameDashboard
      useGameHook={useStagHunt}
      SessionItemComponent={StagHuntSessionItem}
      defaultConfig={{ fee: 1, start: 3, commit: 10, reveal: 10 }}
      emptyStateConfig={{ icon: '🔭', message: 'No sessions found' }}
    />
  )
}
