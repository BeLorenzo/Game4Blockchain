/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { PirateGameSession } from '../../../hooks/Pirate/types' // Types corretti
import { BaseSessionCard, SessionCardHeader, SessionCardBody } from '../../common/BaseSessionCard'
import { PirateCrewList } from './PirateCrewList'
import { ProposalStatus } from './ProposalStatus'
import { PirateActionPanel } from './PirateActionPannel'
import { GameStateBanner } from './GameStateBanner'

interface PirateSessionItemProps {
  session: PirateGameSession
  myAddress: string
  loading: boolean
  actions: {
    register: () => void
    propose: (dist: number[]) => void
    vote: (choice: 0 | 1) => void
    reveal: () => void
    execute: () => void
    claim: () => void
    timeout: () => void
  }
}

export const PirateSessionItem: React.FC<PirateSessionItemProps> = ({ session, myAddress, loading, actions }) => {
  
  // Helpers Colori Fase
  const getPhaseStyle = (p: string) => {
    switch(p) {
      case 'REGISTRATION': return 'bg-blue-600/20 text-blue-400 border-blue-500/50'
      case 'PROPOSAL': return 'bg-purple-600/20 text-purple-400 border-purple-500/50 animate-pulse'
      case 'VOTE_COMMIT': return 'bg-yellow-600/20 text-yellow-400 border-yellow-500/50'
      case 'VOTE_REVEAL': return 'bg-orange-600/20 text-orange-400 border-orange-500/50'
      case 'FINISHED': return 'bg-green-600/20 text-green-400 border-green-500/50'
      default: return 'bg-gray-700 text-gray-300'
    }
  }

  return (
    <BaseSessionCard 
      id={session.id} 
      isEnded={session.phase === 'FINISHED'} 
      borderColorClass={session.canClaim ? 'border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 'border-white/10'}
    >
      
      {/* --- HEADER --- */}
      <SessionCardHeader>
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black font-mono text-white/20">#{session.id}</span>
            <div className={`badge badge-lg font-bold border ${getPhaseStyle(session.phase)}`}>
              {session.phase.replace('_', ' ')}
            </div>
            {/* Round Counter (Mostra il round di gioco, non il blocco) */}
            <div className="hidden sm:flex text-[10px] font-mono text-gray-500 bg-black/30 px-2 py-1 rounded border border-white/5 items-center gap-1">
                <span>ROUND:</span> 
                <span className="text-white font-bold">{session.gameRound}</span>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">BOOTY (POT)</div>
            <div className="text-2xl font-black text-primary drop-shadow-[0_0_8px_rgba(64,224,208,0.5)]">
              {session.totalPot.toFixed(2)} <span className="text-sm">ALGO</span>
            </div>
          </div>
        </div>
      </SessionCardHeader>

      {/* --- BODY --- */}
      <SessionCardBody isEnded={session.phase === 'FINISHED'}>
        
        <GameStateBanner session={session} />
        
        {/* 1. Pirate List */}
        <div className="mb-6">
          <div className="flex justify-between items-end mb-2">
            <h5 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                The Crew ({session.alivePiratesCount} Alive)
            </h5>
            <span className="text-[10px] font-mono text-gray-600">
                Entry Fee: <span className="text-white">{session.fee} A</span>
            </span>
          </div>
          <PirateCrewList 
            pirates={session.pirates} 
            myAddress={myAddress}
            currentProposerIndex={session.currentProposerIndex} 
          />
        </div>

        {/* 2. Proposal Visualization */}
        {/* Mostriamo la proposta se esiste (Fase Vote, Reveal o Finished) */}
        {(session.currentProposal || session.phase === 'FINISHED') && (
          <div className="mb-6">
             <ProposalStatus 
               proposal={session.currentProposal} 
               pirates={session.pirates}
               aliveCount={session.alivePiratesCount}
             />
          </div>
        )}

        {/* 3. ACTIONS PANEL (Nuovo) */}
        {/* Usiamo una key che include fase e round per forzare il re-render pulito dei form quando cambia turno */}
        <div className="border-t border-white/5 pt-6 mt-4">
            <PirateActionPanel 
                session={session} 
                loading={loading} 
                actions={actions}
                key={`${session.id}-${session.phase}-${session.gameRound}`}
            />
        </div>

        {/* Footer Info: Timing & Blocks */}
        <div className="mt-4 flex justify-between text-[10px] uppercase font-mono text-gray-600 border-t border-white/5 pt-2">
           <div className="flex gap-4">
             <span>Block: <span className="text-gray-400">{session.rounds.current}</span></span>
             {session.rounds.endPhase > 0 && session.phase !== 'FINISHED' && (
                <span>
                    Deadline: <span className={session.rounds.current > session.rounds.endPhase ? 'text-red-500 font-bold' : 'text-gray-400'}>
                        {session.rounds.endPhase}
                    </span>
                </span>
             )}
           </div>
           {session.myPirateInfo && (
               <span className={session.myPirateInfo.alive ? 'text-blue-500' : 'text-red-500'}>
                   {session.myPirateInfo.alive ? 'STATUS: ALIVE' : 'STATUS: ELIMINATED'}
               </span>
           )}
        </div>

      </SessionCardBody>
    </BaseSessionCard>
  )
}