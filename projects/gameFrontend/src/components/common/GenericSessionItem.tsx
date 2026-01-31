/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { ReactNode } from 'react'
import {
  BaseSessionCard,
  SessionCardHeader,
  SessionCardBody,
} from './BaseSessionCard'
import {
  SessionHeader,
  SessionProgress,
  SessionInfoGrid,
  SessionResultBanner,
} from './SessionCardCommon'
import { BaseGameSession } from './GenericGameDashboard'

/**
 * Props per GenericSessionItem
 */
interface GenericSessionItemProps<T extends BaseGameSession> {
  session: T
  loading: boolean

  // Callbacks
  onReveal: () => void
  onClaim: () => void

  renderGameStats?: (session: T, isEnded: boolean, isRevealPhase: boolean) => ReactNode
  renderJoinControls?: (session: T, loading: boolean, smartCanJoin: boolean) => ReactNode

  getMyValueLabel?: (session: T) => string
  phaseTextOverride?: string
  customBadges?: ReactNode
}

/**
 * Calcola le props comuni per tutte le sessioni
 */
export function useSessionState<T extends BaseGameSession>(session: T) {
  const isTransitionRound = session.rounds.current === session.rounds.endCommit
  const isEnded = session.phase === 'ENDED'
  const isRevealPhase = session.phase === 'REVEAL' || isEnded
  const isLastChanceReveal = session.rounds.current === session.rounds.endReveal

  const smartCanReveal = session.canReveal || (isTransitionRound && session.hasPlayed)
  const smartCanJoin = session.phase === 'COMMIT' && !isTransitionRound && !session.hasPlayed

  const getPhaseEndInfo = () => {
    switch (session.phase) {
      case 'WAITING':
        return `Start: ${session.rounds.start}`
      case 'COMMIT':
        return isTransitionRound ? `REVEAL STARTING...` : `End Commit: ${session.rounds.endCommit}`
      case 'REVEAL':
        return `End Reveal: ${session.rounds.endReveal}`
      case 'ENDED':
        return 'Ended'
      default:
        return ''
    }
  }

  const borderClass =
    session.canClaim && !session.claimResult
      ? 'border-green-500/50 shadow-[0_0_20px_rgba(34,197,94,0.15)]'
      : session.phase === 'COMMIT'
        ? 'hover:border-primary/40'
        : session.phase === 'REVEAL'
          ? 'border-warning/30 hover:border-warning/50'
          : 'border-white/5'

  return {
    isTransitionRound,
    isEnded,
    isRevealPhase,
    isLastChanceReveal,
    smartCanReveal,
    smartCanJoin,
    getPhaseEndInfo,
    borderClass,
  }
}

/**
 * Generic Session Item
 * Gestisce il rendering comune di ogni sessione
 */
export function GenericSessionItem<T extends BaseGameSession>({
  session,
  loading,
  onReveal,
  onClaim,
  renderGameStats,
  renderJoinControls,
  getMyValueLabel = () => '???',
  phaseTextOverride,
  customBadges
}: GenericSessionItemProps<T>) {
  const {
    isTransitionRound,
    isEnded,
    isRevealPhase,
    isLastChanceReveal,
    smartCanReveal,
    smartCanJoin,
    getPhaseEndInfo,
    borderClass,
  } = useSessionState(session)

  return (
    <BaseSessionCard id={session.id} isEnded={isEnded} borderColorClass={borderClass}>
      <SessionCardHeader>
        <SessionHeader
          session={session}
          isEnded={isEnded}
          isTransitionRound={isTransitionRound}
          phaseText={phaseTextOverride}
          customBadges={customBadges}
        />
        <SessionProgress
          session={session}
          isEnded={isEnded}
          isLastChanceReveal={isLastChanceReveal}
          endLabel={getPhaseEndInfo()}
        />
      </SessionCardHeader>

      <SessionCardBody isEnded={isEnded}>
        <SessionInfoGrid session={session} isEnded={isEnded} />

        {/* Game-specific stats (es: average/target, day counts, ecc) */}
        {renderGameStats && renderGameStats(session, isEnded, isRevealPhase)}

        {/* Result banner */}
        <SessionResultBanner
          session={session}
          isEnded={isEnded}
          myValueLabel={getMyValueLabel(session)}
        />

        {/* Actions */}
        <div className={`flex justify-end gap-3 pt-5 mt-4 border-t ${isEnded ? 'border-white/5' : 'border-white/10'}`}>
          {/* REVEAL Button */}
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
              {isLastChanceReveal ? `⚠️ LAST CHANCE` : 'REVEAL'}
            </button>
          )}

          {/* CLAIM Button */}
          {session.canClaim && !session.claimResult && (
            <button
              className="btn btn-accent w-full md:w-auto font-black text-white tracking-widest shadow-[0_0_20px_#00539C] animate-bounce-subtle border-white/20 hover:scale-105"
              onClick={onClaim}
              disabled={loading}
            >
              CLAIM PRIZE
            </button>
          )}

          {/* Game-specific JOIN controls */}
          {smartCanJoin && renderJoinControls && renderJoinControls(session, loading, smartCanJoin)}

          {/* Commit closed message */}
          {isTransitionRound && !session.hasPlayed && (
            <div className="text-xs text-red-400 font-bold flex items-center bg-red-900/10 px-4 py-2 rounded border border-red-500/20 tracking-wider">
              COMMIT CLOSED
            </div>
          )}
        </div>
      </SessionCardBody>
    </BaseSessionCard>
  )
}
