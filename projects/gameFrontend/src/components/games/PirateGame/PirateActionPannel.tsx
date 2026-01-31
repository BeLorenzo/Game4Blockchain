import React from 'react'
import { PirateGameSession } from '../../../hooks/Pirate/types'
import { MakeProposalForm } from './MakeProposalForm'

interface PirateActionPanelProps {
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

export const PirateActionPanel: React.FC<PirateActionPanelProps> = ({ session, loading, actions }) => {
  const { phase, myPirateInfo, myVote, rounds, canExecute, pirates, gameRound } = session
  const isMeRegistered = !!myPirateInfo
  const isMeAlive = myPirateInfo?.alive ?? false
  
  if (phase === 'ENDED' && pirates.length < 3) {
      if (isMeRegistered && !myPirateInfo?.claimed) {
         return (
           <button onClick={actions.timeout} disabled={loading} className="btn btn-warning w-full font-bold animate-pulse">
             💸 CLAIM REFUND (TIMEOUT)
           </button>
         )
      }
      return <div className="text-center text-gray-500 text-xs font-mono">GAME CANCELLED</div>
  }

  if (isMeRegistered && !isMeAlive && phase !== 'ENDED') {
    return (
      <div className="alert alert-error bg-red-900/20 border-red-500/30 p-3 shadow-lg">
        <h3 className="font-bold text-red-400 text-sm">ELIMINATED</h3>
        <div className="text-xs text-red-300 opacity-70">You walk the plank.</div>
      </div>
    )
  }

  if (phase === 'REGISTRATION') {
    if (session.canRegister) {
      return (
          <button onClick={actions.register} disabled={loading} className="btn btn-primary w-full font-black tracking-widest shadow-[0_0_20px_rgba(64,224,208,0.3)]">
            JOIN CREW ({session.fee} A)
          </button>
      )
    }
    if (isMeRegistered) return <div className="badge badge-success badge-outline w-full p-3 font-bold">✓ REGISTERED</div>
    return <div className="text-gray-500 text-xs font-mono animate-pulse">WAITING FOR START...</div>
  }

  if (phase === 'PROPOSAL') {
    if (rounds.current > rounds.endPhase) {
      return (
         <button onClick={actions.timeout} disabled={loading} className="btn btn-error w-full font-bold shadow-[0_0_15px_red] animate-pulse">
           ☠️ EXECUTE CAPTAIN (TIMEOUT)
         </button>
      )
    }
    if (session.canPropose) {
      return <MakeProposalForm pirates={pirates} totalPot={session.totalPot} onSubmit={actions.propose} loading={loading} />
    }
    return (
      <div className="alert bg-purple-900/10 border-purple-500/20 p-3 flex justify-center">
        <span className="loading loading-dots loading-sm text-purple-400"></span>
        <span className="text-xs text-purple-300 font-mono ml-2">Captain #{session.currentProposerIndex} is thinking...</span>
      </div>
    )
  }

  if (phase === 'VOTE_COMMIT') {
    if (myVote?.hasCommitted) {
      return (
        <div className="w-full flex flex-col gap-2">
            <div className="badge badge-lg badge-success gap-2 p-4 w-full border-0 bg-green-500 text-black font-bold">VOTE COMMITTED</div>
            <div className="text-xs text-center text-gray-500">Wait for reveal phase...</div>
        </div>
      )
    }
    if (session.canVote) {
      return (
        <div className="bg-yellow-900/10 p-4 rounded-xl border border-yellow-500/20 w-full">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-yellow-500 font-bold text-xs uppercase">CAST VOTE</h4>
            <span className="text-[10px] text-gray-500 font-mono">DEADLINE: {rounds.endPhase}</span>
          </div>
          <div className="join w-full">
            <button onClick={() => actions.vote(1)} disabled={loading} className="btn join-item btn-success flex-1 font-black text-black">AYE! (YES)</button>
            <button onClick={() => actions.vote(0)} disabled={loading} className="btn join-item btn-error flex-1 font-black text-black">DIE! (NO)</button>
          </div>
        </div>
      )
    }
    if (session.canReveal) {
        return <button onClick={actions.reveal} disabled={loading} className="btn btn-warning w-full font-black animate-pulse">🔓 START REVEAL</button>
    }
    return <div className="text-gray-500 text-xs text-center font-mono">VOTING IN PROGRESS...</div>
  }

  if (phase === 'VOTE_REVEAL') {
    if (rounds.current > rounds.endPhase) {
        return (
            <button 
                onClick={actions.execute} 
                disabled={loading} 
                className="btn btn-error w-full font-bold mt-2 shadow-[0_0_20px_red] animate-pulse"
            >
                ☠️ EXECUTE ROUND (TIME UP)
            </button>
        )
    }
    if (session.canReveal) {
      return (
        <div className="flex flex-col gap-3 w-full p-3 bg-blue-900/10 rounded-xl border border-blue-500/20">
          <div className="text-center text-xs text-gray-400">
            You committed: <span className={`font-black ${myVote?.voteDirection === 1 ? 'text-green-400' : 'text-red-400'}`}>{myVote?.voteDirection === 1 ? 'AYE' : 'NAY'}</span>
          </div>
          <button onClick={actions.reveal} disabled={loading} className="btn btn-warning w-full font-black animate-pulse">🔓 REVEAL VOTE</button>
        </div>
      )
    }
    
    if (rounds.current > rounds.endPhase) {
        return <button onClick={actions.execute} disabled={loading} className="btn btn-error w-full font-bold mt-2">☠️ EXECUTE ROUND (CALCULATE)</button>
    }

    if (myVote?.hasRevealed) {
       return <div className="badge badge-lg badge-info gap-2 p-4 w-full font-bold border-0 bg-blue-500 text-black">✓ VOTE REVEALED</div>
    }
    
    return <div className="text-gray-500 text-xs text-center font-mono">WAITING FOR REVEALS...</div>
  }

  if (phase === 'ENDED') {
    if (session.canClaim) {
      return <button onClick={actions.claim} disabled={loading} className="btn btn-accent btn-lg w-full font-black shadow-[0_0_30px_#40E0D0] animate-bounce-subtle">💰 CLAIM WINNINGS</button>
    }
    if (myPirateInfo?.claimed) {
      return <div className="text-center p-3 bg-green-900/20 rounded-lg border border-green-500/30 w-full font-bold text-green-400">LOOT CLAIMED</div>
    }
    return <div className="text-gray-500 text-xs text-center font-mono">GAME ENDED</div>
  }

  return null
}