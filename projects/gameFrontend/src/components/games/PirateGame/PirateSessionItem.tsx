import React from 'react'
import { BaseSessionCard, SessionCardHeader, SessionCardBody } from '../../common/BaseSessionCard'
import { PirateGameSession } from '../../../hooks/Pirate/types'

import { GameStateBanner } from './GameStateBanner'
import { ProposalStatus } from './ProposalStatus'
import { PirateCrewList } from './PirateCrewList'
import { PirateActionPanel } from './PirateActionPannel'

const PirateResultBanner = ({ session }: { session: PirateGameSession }) => {
  if (!session.myPirateInfo || !session.claimResult) return null
  
  const { amount, isTimeout } = session.claimResult
  const displayAmount = Math.abs(amount)

  // Configurazione Dinamica Testi e Colori
  let title = ''
  let subtitle = ''
  let amountSign = ''
  let gradientClass = ''
  let textClass = ''
  let borderClass = ''

  if (amount > 0) {
      // VITTORIA
      title = '🏆 VICTORY!'
      subtitle = 'NET PROFIT'
      amountSign = '+'
      gradientClass = 'bg-gradient-to-br from-green-900 to-black'
      textClass = 'text-green-400'
      borderClass = 'border-green-500'
  } else if (amount === 0) {
      // RIMBORSO / PAREGGIO
      title = isTimeout ? '💸 REFUNDED' : '⚓ NO LOSS'
      subtitle = isTimeout ? 'FULL FEE RETURNED' : 'BROKE EVEN'
      amountSign = isTimeout ? '+' : ''
      gradientClass = 'bg-gradient-to-br from-yellow-900 to-black'
      textClass = 'text-yellow-400'
      borderClass = 'border-yellow-500'
  } else {
      // SCONFITTA
      title = '☠️ YOU LOST' 
      subtitle = 'BETTER LUCK NEXT TIME' 
      amountSign = '-'
      gradientClass = 'bg-gradient-to-br from-red-900 to-black'
      textClass = 'text-red-400'
      borderClass = 'border-red-500'
  }

  const finalAmountDisplay = (amount === 0 && isTimeout) ? session.fee : displayAmount

  return (
    <div className="mt-4 mb-4">
        <div className={`p-5 rounded-xl w-full text-center font-black uppercase tracking-widest shadow-2xl transform transition-all hover:scale-[1.01] relative z-20 opacity-100 border ${gradientClass} ${borderClass} ${textClass}`}>
             <div className="flex flex-col items-center gap-1">
                <span className={`text-lg mb-1 ${amount < 0 ? 'text-red-500' : ''}`}>{title}</span>
                
                <span className="text-4xl font-mono text-white text-shadow-sm">
                    {amountSign}{finalAmountDisplay.toFixed(2)} ALGO
                </span>
                
                <span className={`text-[10px] opacity-70 mt-1 ${amount < 0 ? 'text-red-300' : ''}`}>{subtitle}</span>
            </div>
        </div>
    </div>
  )
}

interface PirateSessionItemProps {
  session: PirateGameSession
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

export const PirateSessionItem: React.FC<PirateSessionItemProps> = ({ session, loading, actions }) => {
  const isEnded = session.phase === 'ENDED'
  const isRefundAvailable = session.phase === 'ENDED' && 
                            session.pirates.length < 3 && 
                            !!session.myPirateInfo && 
                            !session.myPirateInfo.claimed

  let borderColor = 'border-white/5'
  let phaseColor = 'badge-ghost' 

  if (session.phase === 'PROPOSAL') {
      borderColor = 'border-purple-500 shadow-[0_0_15px_rgba(147,51,234,0.3)]'
      phaseColor = 'badge-secondary bg-purple-500 text-black border-purple-500'
  } else if (session.phase === 'VOTE_COMMIT') {
      borderColor = 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]'
      phaseColor = 'badge-warning bg-yellow-500 text-black border-yellow-500'
  } else if (session.phase === 'VOTE_REVEAL') {
      borderColor = 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
      phaseColor = 'badge-info bg-blue-500 text-black border-blue-500'
  } else if (session.canExecute) {
      borderColor = 'border-red-500 animate-pulse'
  }

  if (isRefundAvailable) {
      borderColor = 'border-yellow-500 animate-pulse shadow-[0_0_20px_rgba(234,179,8,0.4)]'
  }

  const getRoundLabel = () => {
    if (session.phase === 'REGISTRATION') return `End Registration: ${session.rounds.endPhase}`
    if (session.phase === 'PROPOSAL') return `End Proposal: ${session.rounds.endPhase}`
    if (session.phase === 'VOTE_COMMIT') return `End Commit: ${session.rounds.endPhase}`
    if (session.phase === 'VOTE_REVEAL') return `End Reveal: ${session.rounds.endPhase}`
    return 'Game Ended'
  }

  return (
    <BaseSessionCard id={session.id} isEnded={isEnded} borderColorClass={borderColor}>
      
      <SessionCardHeader>
        <div className="flex justify-between items-start mb-2">
           <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                 <span className="font-mono text-xl font-black text-white/40">#{session.id}</span>
                 <div className={`badge ${phaseColor} font-bold uppercase tracking-wider`}>
                    {session.phase.replace('_', ' ')}
                 </div>
                {isRefundAvailable && (
                    <div className="badge badge-warning badge-outline font-black animate-pulse bg-yellow-500/10 shadow-lg">
                        💸 REFUND AVAILABLE
                    </div>
                 )}

                 {/* Badge EXECUTE (Per Timeout, No Proposal o Reveal Scaduto) */}
                 {session.canExecute && (
                    <div className="badge badge-error badge-outline font-black animate-pulse bg-red-500/10 shadow-[0_0_15px_red] border-red-500 text-red-500">
                        ☠️ EXECUTE AVAILABLE
                    </div>
                 )}
              </div>
              <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mt-1">
                  Current Round: <span className="text-white font-bold">{session.rounds.current}</span>
                  <span className="mx-2">•</span>
                  {getRoundLabel()}
              </div>
           </div>
           
           <div className="text-right">
              <div className="font-black text-2xl text-yellow-500 drop-shadow-md">
                  {session.totalPot.toFixed(1)} <span className="text-[10px] text-yellow-700">GOLD</span>
              </div>
              <div className="text-[10px] font-bold text-gray-500 uppercase">
                  Alive: {session.alivePiratesCount} / {session.pirates.length}
              </div>
           </div>
        </div>
        
        {!isEnded && (
            <progress 
                className={`progress w-full h-1 mt-2 ${session.phase === 'VOTE_REVEAL' ? 'progress-info' : session.phase === 'PROPOSAL' ? 'progress-secondary' : 'progress-warning'}`} 
                value={Math.max(0, session.rounds.current - session.rounds.start)} 
                max={session.rounds.endPhase - session.rounds.start}
            ></progress>
        )}
      </SessionCardHeader>

      <SessionCardBody isEnded={isEnded}>
        
        {/* 1. Messaggi Globali */}
        <GameStateBanner session={session} />

        {/* 2. Risultato Personale */}
        <PirateResultBanner session={session} />

        {/* 3. Proposta (se attiva) */}
        {session.currentProposal && (
            <div className="mb-6">
                <ProposalStatus 
                    proposal={session.currentProposal} 
                    pirates={session.pirates} 
                    aliveCount={session.alivePiratesCount} 
                    myAddress={session.myPirateInfo?.address} 
                    phase={session.phase}
                />
            </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">The Crew</h4>
                <PirateCrewList 
                    pirates={session.pirates} 
                    myAddress={session.myPirateInfo?.address} 
                    currentProposerIndex={session.currentProposerIndex} 
                />
            </div>

            <div className="flex flex-col justify-end">
                <PirateActionPanel 
                    session={session} 
                    loading={loading} 
                    actions={actions} 
                />
            </div>
        </div>
      </SessionCardBody>
    </BaseSessionCard>
  )
}