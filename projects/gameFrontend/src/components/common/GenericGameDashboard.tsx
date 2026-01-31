/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useGameSpecificProfit, usePlayerStats } from '../../hooks/usePlayerStats'
import { GameDashboardLayout } from './GameDashboardLayout'
import { GameStats } from './GameStats'
import { GameFilters } from './GameFilters'
import { CreateSessionForm } from './CreateSessionForm'

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

interface GenericGameDashboardProps<T extends BaseGameSession> {
  useGameHook: () => BaseGameHook<T> & { [key: string]: any }
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
  gamePrefix: string
  appId: number | bigint
  renderHeader?: (hookData: any) => React.ReactNode
}

export function GenericGameDashboard<T extends BaseGameSession>({
  useGameHook,
  SessionItemComponent,
  defaultConfig = { fee: 1, start: 1, commit: 5, reveal: 5 },
  emptyStateConfig = { icon: '🔭', message: 'No sessions found' },
  gamePrefix, 
  appId,    
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
    ...hookRest
  } = useGameHook()
  const { activeAddress } = useWallet()
  const totalProfit = useGameSpecificProfit(gamePrefix, appId).profit

  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'mine'>('active')
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED'>('ALL')
  const [newConfig, setNewConfig] = useState(defaultConfig)

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
      stats={activeAddress && <GameStats totalProfit={totalProfit} mbr={mbrs.create} />}
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
            createSession(newConfig.fee, newConfig.start, newConfig.commit, newConfig.reveal)
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

      {!isInitializing && (
        <div
            className="flex-1 overflow-y-auto pr-2 space-y-4 pb-20 custom-scrollbar h-[75vh] min-h-[650px]"
        >
            {sessions.map((session) => (
              <SessionItemComponent
                key={session.id}
                session={session}
                loading={loading}
                onJoin={(...args) => joinSession(...args)}
                onReveal={() => revealMove(session.id)}
                onClaim={() => claimWinnings(session.id, session.fee)}
                {...hookRest}
              />
            ))}

            {sessions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 opacity-40 border-2 border-dashed border-white/10 rounded-2xl bg-white/5">
                  <div className="text-4xl mb-2">{emptyStateConfig.icon}</div>
                  <div className="font-mono text-lg font-bold tracking-widest uppercase">
                    {emptyStateConfig.message}
                  </div>
                </div>
            )}
        </div>
      )}
    </GameDashboardLayout>
  )
}
