/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'

// --- Imports Componenti Generici ---
import { GameDashboardLayout } from '../../common/GameDashboardLayout'
import { GameFilters, GamePhaseFilter } from '../../common/GameFilters'
import { GameStats } from '../../common/GameStats'

// --- Imports Componenti Specifici Pirate ---
import { PirateSessionItem } from './PirateSessionItem'
import { PirateCreateSessionForm, CreateSessionParams } from './PirateCreateSessionsForm'

// --- Import Hook & Types ---
import { usePirateGame } from '../../../hooks/Pirate/usePirateGame'
import { PirateGameSession } from '../../../hooks/Pirate/types'

export const PirateGameDashboard = () => {
  const { activeAddress } = useWallet()
  
  // Stato UI
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'mine'>('active')
  const [phaseFilter, setPhaseFilter] = useState<GamePhaseFilter>('ALL')
  
  // HOOK: Recupera la lista delle sessioni
  const { sessions, loading, actions } = usePirateGame()

  // HANDLER: Creazione Sessione
  const handleCreate = async (params: CreateSessionParams) => {
    await actions.create(
      params.fee,
      params.maxPirates,
      params.regDuration,
      params.commitDuration,
      params.revealDuration
    )
  }

  // --- LOGICA FILTRI ---
  const filteredSessions = sessions.filter((session: PirateGameSession) => {
    // 1. Filtro Fase (Dropdown)
    if (phaseFilter !== 'ALL') {
      let matches = false
      if (phaseFilter === 'WAITING' && session.phase === 'REGISTRATION') matches = true
      if (phaseFilter === 'COMMIT' && (session.phase === 'PROPOSAL' || session.phase === 'VOTE_COMMIT')) matches = true
      if (phaseFilter === 'REVEAL' && session.phase === 'VOTE_REVEAL') matches = true
      if (phaseFilter === 'ENDED' && session.phase === 'FINISHED') matches = true
      
      if (!matches) return false
    }

    // 2. Filtro Tab (Active / History / Mine)
    switch (activeTab) {
      case 'active':
        return session.phase !== 'FINISHED'
      case 'history':
        return session.phase === 'FINISHED'
      case 'mine':
        return !!session.myPirateInfo
      default:
        return true
    }
  })

  // --- CALCOLO STATS ---
  const myTotalProfit = sessions.reduce((acc, s) => {
      // Se ho vinto (claimed)
      if (s.myPirateInfo?.claimed) return acc + (s.totalPot - s.fee)
      // Se ho solo partecipato (spesa)
      if (s.myPirateInfo) return acc - s.fee
      return acc
  }, 0)

  // Recuperiamo il blocco corrente (fallback a 0 se nessuna sessione)
  const currentBlock = sessions.length > 0 ? sessions[0].rounds.current : 0

  return (
    <GameDashboardLayout
      title="PIRATE GAME"
      
      // Statistiche
      stats={
        activeAddress && (
          <GameStats 
            totalProfit={myTotalProfit} 
            mbr={0.379} 
          />
        )
      }

      // Sezione Creazione
      createGameSection={
        <PirateCreateSessionForm 
          currentRound={currentBlock}
          onCreate={handleCreate}
          isLoading={loading}
        />
      }

      // Filtri
      filters={
        <GameFilters 
          activeTab={activeTab} 
          setActiveTab={setActiveTab}
          phaseFilter={phaseFilter} 
          setPhaseFilter={setPhaseFilter}
        />
      }
    >
      <div className="pb-20 space-y-4 min-h-[300px]">
        
        {/* Loading */}
        {loading && sessions.length === 0 && (
           <div className="flex justify-center py-20">
             <span className="loading loading-bars loading-lg text-primary"></span>
           </div>
        )}

        {/* LISTA SESSIONI */}
        {filteredSessions.map((session) => (
            <PirateSessionItem 
                key={session.id}
                session={session}
                myAddress={activeAddress || ''}
                loading={loading}
                // LEGARE LE AZIONI ALL'ID DELLA SESSIONE CORRENTE
                actions={{
                    register: () => actions.register(session.id, session.fee),
                    propose: (dist) => actions.propose(session.id, dist, session.totalPot),
                    vote: (vote) => actions.vote(session.id, vote, session.gameRound),
                    reveal: () => actions.reveal(session.id, session.gameRound),
                    execute: () => actions.execute(session.id),
                    claim: () => actions.claim(session.id),
                    timeout: () => actions.timeout(session.id)
                }}
            />
        ))}

        {/* Empty State */}
        {!loading && filteredSessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 opacity-40 border-2 border-dashed border-white/10 rounded-2xl bg-white/5">
            <div className="text-4xl mb-3">🔭</div>
            <div className="font-mono text-lg font-bold tracking-widest uppercase">
              No voyages found
            </div>
            <div className="text-xs text-gray-500 font-mono mt-1">
              Start a new game or check filters
            </div>
          </div>
        )}
      </div>
    </GameDashboardLayout>
  )
}