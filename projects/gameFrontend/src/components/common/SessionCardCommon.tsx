/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'

// --- HEADER  ---
export const SessionHeader = ({ session, isEnded, isTransitionRound, phaseText, customBadges }: any) => {
  const textVal = isEnded ? 'text-gray-300' : 'text-white'
  const textDim = isEnded ? 'text-gray-500' : 'text-gray-400'

  return (
    <div className="flex justify-between items-center mb-4">
      <div className="flex items-center gap-4">
        <span className={`font-mono text-2xl font-black ${isEnded ? 'opacity-20 text-gray-600' : 'opacity-30 text-white'}`}>#{session.id}</span>
        
        <div className={`badge badge-lg font-bold tracking-wider border-0 px-4 py-3 ${
           isEnded ? 'bg-white/5 text-gray-400 border border-white/5' :
           session.phase === 'COMMIT' ? 'bg-primary text-black' :
           session.phase === 'REVEAL' ? 'bg-yellow-500 text-black animate-pulse' :
           session.phase === 'WAITING' ? 'bg-blue-400 text-black' : 'bg-gray-700'
        }`}>
          {isTransitionRound ? 'REVEAL READY' : phaseText || session.phase}
        </div>

        {session.canClaim && !session.claimResult && (
          <div className="badge badge-success badge-outline badge-lg font-bold animate-pulse shadow-lg bg-green-500/10">CLAIM AVAILABLE</div>
        )}

        {customBadges}
        
      </div>
      <div className="text-right">
        <div className={`font-black text-2xl ${textVal}`}>{session.totalPot.toFixed(1)} <span className="text-sm text-primary font-mono font-medium">ALGO</span></div>
        <div className={`text-xs font-mono font-bold tracking-widest uppercase ${textDim}`}>Players: {session.playersCount}</div>
      </div>
    </div>
  )
}

// --- PROGRESS BAR ---
export const SessionProgress = ({ session, isEnded, isLastChanceReveal, endLabel }: any) => {
  const textVal = isEnded ? 'text-gray-300' : 'text-white'
  const textDim = isEnded ? 'text-gray-500' : 'text-gray-400'

  return (
    <>
      <div className={`flex justify-between text-xs font-mono uppercase tracking-wide mb-2 ${textDim}`}>
         <span>Current Round: <span className={`${textVal} font-bold ml-1 text-sm`}>{session.rounds.current}</span></span>
         <span className={`text-right font-bold ${isEnded ? 'text-gray-500' : 'text-primary'}`}>{endLabel}</span>
      </div>
      <progress
        className={`progress w-full h-1.5 ${isEnded ? 'bg-gray-800 [&::-webkit-progress-value]:bg-gray-600' : isLastChanceReveal ? 'progress-error shadow-[0_0_10px_red]' : 'progress-primary'}`}
        value={Math.max(0, session.rounds.current - session.rounds.start)}
        max={session.rounds.endReveal - session.rounds.start}
      ></progress>
    </>
  )
}

// --- INFO GRID (Start, End, Fee) ---
export const SessionInfoGrid = ({ session, isEnded }: any) => {
  const textVal = isEnded ? 'text-gray-300' : 'text-white'
  return (
    <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 text-xs uppercase font-mono p-4 rounded-lg border ${isEnded ? 'bg-[#050505] border-white/5' : 'bg-[#0f0f0f] border-white/5'}`}>
       <div className="flex flex-col gap-1"><span className="text-gray-500 font-bold tracking-widest text-[10px]">Start</span><span className={`${textVal} font-bold text-sm`}>{session.rounds.start}</span></div>
       <div className="flex flex-col gap-1"><span className="text-gray-500 font-bold tracking-widest text-[10px]">End Commit</span><span className={`${textVal} font-bold text-sm`}>{session.rounds.endCommit}</span></div>
       <div className="flex flex-col gap-1"><span className="text-gray-500 font-bold tracking-widest text-[10px]">End Reveal</span><span className={`${textVal} font-bold text-sm`}>{session.rounds.endReveal}</span></div>
       <div className="flex flex-col gap-1"><span className="text-gray-500 font-bold tracking-widest text-[10px]">Fee</span><span className="text-primary font-bold text-sm">{session.fee} A</span></div>
    </div>
  )
}

// --- RESULT BANNER ---
export const SessionResultBanner = ({ session, isEnded, myValueLabel }: any) => {
  if (!session.hasPlayed) return null;

  return (
    <div className="space-y-4 mt-4">
      <div className={`flex justify-between items-center px-5 py-3 rounded-lg border ${isEnded ? 'bg-white/5 border-white/5' : 'bg-white/5 border-white/10'}`}>
         <span className="text-sm font-medium text-gray-400">Your Pick: <strong className="text-xl ml-2 text-white font-mono">{myValueLabel}</strong></span>
         {session.hasRevealed ? <div className="badge badge-success badge-sm font-bold text-black">REVEALED</div> : <div className="badge badge-warning badge-sm animate-pulse font-bold text-black">TO REVEAL</div>}
      </div>
      {session.claimResult && (
        <div className={`p-5 rounded-xl w-full text-center font-black uppercase tracking-widest shadow-2xl transform transition-all hover:scale-[1.01] relative z-20 opacity-100 ${session.claimResult.amount >= 0 ? 'bg-gradient-to-br from-green-900 to-black border border-green-500 text-green-400' : 'bg-gradient-to-br from-red-900 to-black border border-red-500 text-red-400'}`}>
          {session.claimResult.amount > 0 ? (
            <div className="flex flex-col items-center gap-1"><span className="text-lg text-green-500 mb-1">🏆 YOU WON</span><span className="text-4xl font-mono text-white text-shadow-sm">+{session.claimResult.amount.toFixed(2)} ALGO</span></div>
          ) :  session.claimResult.amount == 0 ? (
            <div className="flex flex-col items-center gap-1"><span className="text-lg text-yellow-500 mb-1">YOU DID NOT WIN </span><span className="text-4xl font-mono text-white text-shadow-sm">+{session.claimResult.amount.toFixed(2)} ALGO</span></div>
          ): session.claimResult.isTimeout ? (
            <div className="flex flex-col items-center gap-1"><span className="text-sm text-red-400 opacity-80 mb-1">⏱️ TIME OUT</span><span className="text-2xl font-mono text-white">{session.claimResult.amount.toFixed(2)} ALGO</span></div>
          ) : (
            <div className="flex flex-col items-center gap-1"><span className="text-lg text-red-500 mb-1">💀 YOU LOST</span><span className="text-2xl font-mono text-white">{session.claimResult.amount.toFixed(2)} ALGO</span></div>
          )}
        </div>
      )}
    </div>
  )
}
