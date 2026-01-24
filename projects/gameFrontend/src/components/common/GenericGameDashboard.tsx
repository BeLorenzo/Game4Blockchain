/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, ReactNode } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { usePlayerStats } from '../../hooks/usePlayerStats'
import { GameDashboardLayout } from './GameDashboardLayout'
import { GameStats } from './GameStats'
import { GameFilters } from './GameFilters'
import { CreateSessionForm } from './CreateSessionForm'

/**
 * Generic Session Interface
 */
export interface BaseGameSession {
  id: number
  phase: 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'
  rounds: {
    current: number
    start: number
    endCommit: number
    endReveal: number
  }
  fee: number
  playersCount: number
  hasPlayed: boolean
  hasRevealed?: boolean
  canReveal: boolean
  canClaim: boolean
  claimResult?: any
}

/**
 * Generic Hook Return Type
 */
export interface BaseGameHook<T extends BaseGameSession> {
  activeSessions: T[]
  historySessions: T[]
  mySessions: T[]
  mbrs: { create: number }
  loading: boolean
  isInitializing: boolean
  createSession: (fee: number, start: number, commit: number, reveal: number) => void
  joinSession: (...args: any[]) => void
  revealMove: (id: number) => void
  claimWinnings: (id: number, fee: number) => void
}

/**
 * Props per il componente GenericGameDashboard
 */
interface GenericGameDashboardProps<T extends BaseGameSession> {
  useGameHook: () => BaseGameHook<T>

  SessionItemComponent: React.ComponentType<{
    session: T
    loading: boolean
    onJoin: (...args: any[]) => void
    onReveal: () => void
    onClaim: () => void
    [key: string]: any
  }>

  defaultConfig?: {
    fee: number
    start: number
    commit: number
    reveal: number
  }

  emptyStateConfig?: {
    icon: string
    message: string
  }
}

/**
 * Generic Game Dashboard
 * Gestisce tutta la logica comune a tutti i giochi:
 * - Tabs (active/history/mine)
 * - Filtri per fase
 * - Creazione sessione
 * - Rendering sessioni
 */
export function GenericGameDashboard<T extends BaseGameSession>({
  useGameHook,
  SessionItemComponent,
  defaultConfig = { fee: 1, start: 5, commit: 50, reveal: 50 },
  emptyStateConfig = { icon: '🔭', message: 'No sessions found' },
}: GenericGameDashboardProps<T>) {
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
  } = useGameHook()

  // Wallet e stats
  const { activeAddress } = useWallet()
  const { totalProfit } = usePlayerStats(activeAddress || undefined)

  // State comune
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'mine'>('active')
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'>('ALL')
  const [newConfig, setNewConfig] = useState(defaultConfig)

  // Logica di filtraggio
  const getDisplaySessions = (): T[] => {
    let list: T[] = []
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
    <GameDashboardLayout
      title="Create New Game"
      stats={
        activeAddress && (
          <GameStats totalProfit={totalProfit} mbr={mbrs.create} />
        )
      }
      filters={
        <GameFilters
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          phaseFilter={phaseFilter}
          setPhaseFilter={setPhaseFilter}
        />
      }
      createGameSection={
        <CreateSessionForm
          config={newConfig}
          setConfig={setNewConfig}
          onCreate={() =>
            createSession(
              newConfig.fee,
              newConfig.start,
              newConfig.commit,
              newConfig.reveal,
            )
          }
          loading={loading}
          disabled={loading || !activeAddress || mbrs.create === 0}
        />
      }
    >
      {/* Loading State */}
      {isInitializing && (
        <div className="flex justify-center py-20">
          <span className="loading loading-bars loading-lg text-primary scale-150"></span>
        </div>
      )}

      {/* Session List */}
      {!isInitializing &&
        sessions.map((session) => (
          <SessionItemComponent
            key={session.id}
            session={session}
            loading={loading}
            onJoin={(...args) => joinSession(...args)}
            onReveal={() => revealMove(session.id)}
            onClaim={() => claimWinnings(session.id, session.fee)}
          />
        ))}

      {/* Empty State */}
      {!isInitializing && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 opacity-40 border-2 border-dashed border-white/10 rounded-2xl bg-white/5">
          <div className="text-4xl mb-2">{emptyStateConfig.icon}</div>
          <div className="font-mono text-lg font-bold tracking-widest uppercase">
            {emptyStateConfig.message}
          </div>
        </div>
      )}
    </GameDashboardLayout>
  )
}
