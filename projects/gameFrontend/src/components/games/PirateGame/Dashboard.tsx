import React, { useEffect, useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { usePirateGame } from '../../../hooks/Pirate/usePirateGame'
import { GameDashboardLayout } from '../../common/GameDashboardLayout'
import { GameStats } from '../../common/GameStats'
import { GameFilters, GamePhaseFilter } from '../../common/GameFilters'
import { CreatePirateSessionForm } from './CreatePirateSessionsForm'
import { PirateSessionItem } from './PirateSessionItem'
import { config } from '../../../config'
import { useGameSpecificProfit } from '../../../hooks/usePlayerStats'

export const PirateGameDashboard = () => {
  const { 
    activeSessions, 
    historySessions, 
    mySessions, 
    mbrs, 
    loading, 
    isInitializing,
    actions 
  } = usePirateGame()

  const { activeAddress } = useWallet()
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'mine'>('active')
  const [phaseFilter, setPhaseFilter] = useState<GamePhaseFilter>('ALL')


  const profit = useGameSpecificProfit('pirate', config.games.pirate.appId).profit



  // Logica filtri
  const getDisplaySessions = () => {
    let list = activeTab === 'active' ? activeSessions : 
               activeTab === 'history' ? historySessions : mySessions
    
    if (phaseFilter !== 'ALL') {
      list = list.filter(s => s.phase === phaseFilter)
    }
    return list
  }

  const sessions = getDisplaySessions()

  return (
    <GameDashboardLayout
      title="Create New Game"
      stats={activeAddress && <div className="flex gap-2"><GameStats totalProfit={profit} mbr={mbrs.create} /></div>} // TODO: Add real stats if needed
      filters={
        <GameFilters
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          phaseFilter={phaseFilter}
          setPhaseFilter={setPhaseFilter}
        />
      }
      createGameSection={
        <CreatePirateSessionForm
          onCreate={(cfg) => actions.createSession(cfg.fee, cfg.maxPirates, cfg.regDuration, cfg.commitDuration, cfg.revealDuration)}
          loading={loading}
          disabled={loading || !activeAddress}
        />
      }
    >
      {isInitializing && (
        <div className="flex justify-center py-20">
          <span className="loading loading-bars loading-lg text-primary scale-150"></span>
        </div>
      )}

      {!isInitializing && (
        <div className="flex-1 overflow-y-auto pr-2 space-y-4 pb-20 custom-scrollbar h-[75vh] min-h-[650px]">
          {sessions.map(session => (
            <PirateSessionItem
  key={session.id}
  session={session}
  loading={loading}
  actions={{
    register: () => actions.registerPirate(session.id, session.fee),
    propose: (dist) => actions.proposeDistribution(session.id, dist, session.totalPot),
    
    vote: (vote) => actions.commitVote(session.id, vote, session.gameRound),
    reveal: () => actions.revealVote(session.id, session.gameRound),
    
    execute: () => actions.executeRound(session.id),
    claim: () => actions.claimWinnings(session.id, session.fee),
    timeout: () => actions.handleTimeout(session.id)
  }}
/>
          ))}
           
          {sessions.length === 0 && (
             <div className="flex flex-col items-center justify-center py-24 opacity-40 border-2 border-dashed border-white/10 rounded-2xl bg-white/5">
                <div className="text-4xl mb-2">🏴‍☠️</div>
                <div className="font-mono text-lg font-bold tracking-widest uppercase">No Pirates found</div>
             </div>
          )}
        </div>
      )}
    </GameDashboardLayout>
  )
}