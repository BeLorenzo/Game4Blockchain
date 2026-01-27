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

  // --- 7.7 GESTIONE ELIMINAZIONE ---
  // Se sono morto e non è finito il gioco, mostro status
  if (isMeRegistered && !isMeAlive && phase !== 'FINISHED') {
    return (
      <div className="alert alert-error bg-red-900/20 border-red-500/30 p-3 shadow-lg">
        <div>
          <h3 className="font-bold text-red-400 text-sm">ELIMINATED</h3>
          <div className="text-xs text-red-300 opacity-70">You walk the plank. You can only watch now.</div>
        </div>
      </div>
    )
  }

  // --- EDGE CASE 1: REGISTRATION TIMEOUT (REFUND) ---
  if (phase === 'REGISTRATION' && rounds.current >= rounds.start) {
    if (pirates.length < 3) {
       // Se sono registrato e non ho ancora fatto claim (refund)
       if (isMeRegistered && !myPirateInfo?.claimed) {
         return (
           <button 
             onClick={actions.timeout} 
             disabled={loading} 
             className="btn btn-warning w-full font-bold animate-pulse shadow-[0_0_20px_orange]"
           >
             💸 CLAIM REFUND (TIMEOUT)
           </button>
         )
       }
       return <div className="text-center text-gray-500 text-xs font-mono">GAME CANCELLED</div>
    }
  }

  // --- STANDARD REGISTRATION ---
  if (phase === 'REGISTRATION') {
    if (session.canRegister) {
      return (
        <div className="flex flex-col items-end gap-2 w-full md:w-auto">
          <button onClick={actions.register} disabled={loading} className="btn btn-primary w-full font-black tracking-widest shadow-[0_0_20px_rgba(64,224,208,0.3)]">
            JOIN CREW ({session.fee} A)
          </button>
        </div>
      )
    }
    if (isMeRegistered) {
      return <div className="badge badge-success badge-outline p-3 font-bold">✓ REGISTERED #{myPirateInfo?.seniorityIndex}</div>
    }
    return <div className="text-gray-500 text-xs font-mono animate-pulse">WAITING FOR START...</div>
  }

  // --- EDGE CASE 2: PROPOSAL TIMEOUT ---
  // Se siamo in PROPOSAL e il tempo è scaduto
  if (phase === 'PROPOSAL' && rounds.current > rounds.endPhase) {
      return (
         <button 
           onClick={actions.timeout} 
           disabled={loading} 
           className="btn btn-error w-full font-bold shadow-[0_0_15px_red] animate-pulse"
         >
           ☠️ EXECUTE CAPTAIN (TIMEOUT)
         </button>
      )
  }

  // --- STANDARD PROPOSAL ---
  if (phase === 'PROPOSAL') {
    if (session.canPropose) {
      return <MakeProposalForm pirates={pirates} totalPot={session.totalPot} onSubmit={actions.propose} loading={loading} />
    }
    return (
      <div className="alert bg-purple-900/10 border-purple-500/20 p-3 flex justify-center">
        <span className="loading loading-dots loading-sm text-purple-400"></span>
        <span className="text-xs text-purple-300 font-mono ml-2">Waiting for Captain #{session.currentProposerIndex}...</span>
      </div>
    )
  }

  // --- 7.3 VOTE COMMIT ---
  if (phase === 'VOTE_COMMIT') {
    if (session.canVote) {
      return (
        <div className="bg-yellow-900/10 p-4 rounded-xl border border-yellow-500/20 w-full">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-yellow-500 font-bold text-xs uppercase">CAST VOTE (ROUND {gameRound})</h4>
            <span className="text-[10px] text-gray-500 font-mono">DEADLINE: {rounds.endPhase}</span>
          </div>
          <div className="join w-full">
            <button onClick={() => actions.vote(1)} disabled={loading} className="btn join-item btn-success flex-1 font-black text-black">AYE! (YES)</button>
            <button onClick={() => actions.vote(0)} disabled={loading} className="btn join-item btn-error flex-1 font-black text-black">DIE! (NO)</button>
          </div>
        </div>
      )
    }
    if (myVote?.hasCommitted) {
      return (
        <div className="w-full flex flex-col gap-2">
            <div className="badge badge-lg badge-success gap-2 p-4 w-full border-0 bg-green-500 text-black font-bold">VOTE COMMITTED</div>
            {canExecute && <button onClick={actions.timeout} className="btn btn-outline btn-warning btn-sm w-full">FORCE NEXT PHASE</button>}
        </div>
      )
    }
    if (canExecute) return <button onClick={actions.timeout} className="btn btn-outline btn-warning w-full">FORCE NEXT PHASE</button>
    return <div className="text-gray-500 text-xs text-center font-mono">VOTING IN PROGRESS...</div>
  }

  // --- 7.4 VOTE REVEAL ---
  if (phase === 'VOTE_REVEAL') {
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
    if (myVote?.hasRevealed || (!isMeRegistered && canExecute) || (isMeRegistered && !session.canReveal && canExecute)) {
       // Se ho rivelato, o se sono spettatore e il tempo è scaduto, o se non ho votato e tempo scaduto
       if (canExecute) {
           return <button onClick={actions.execute} disabled={loading} className="btn btn-error w-full font-bold mt-2">☠️ EXECUTE ROUND</button>
       }
       return <div className="badge badge-lg badge-info gap-2 p-4 w-full font-bold border-0 bg-blue-500 text-black">✓ VOTE REVEALED / WAITING</div>
    }
    return <div className="text-gray-500 text-xs text-center font-mono">WAITING FOR REVEALS...</div>
  }

  // --- 7.6 FINISHED ---
  if (phase === 'FINISHED') {
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