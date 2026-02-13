import React from 'react'
import { ProposalInfo, PirateInfo } from '../../../hooks/Pirate/types'

interface ProposalStatusProps {
  proposal: ProposalInfo | null
  pirates: PirateInfo[] 
  aliveCount: number
  myAddress?: string 
  phase: string
}

export const ProposalStatus: React.FC<ProposalStatusProps> = ({ proposal, pirates, aliveCount, myAddress, phase }) => {
  if (!proposal) return null

  const isVoting = phase === 'VOTE_COMMIT'
  const totalVotesCast = proposal.votesFor + proposal.votesAgainst
  
  const yesPercent = totalVotesCast > 0 ? (proposal.votesFor / totalVotesCast) * 100 : 0
  const noPercent = totalVotesCast > 0 ? (proposal.votesAgainst / totalVotesCast) * 100 : 0

  const DistributionContent = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono mt-2">
      {proposal.distribution.map((amount, idx) => {
        const pirate = pirates[idx];
        const isMe = pirate?.address === myAddress;

        if (amount <= 0 && !pirate?.alive) return null;

        return (
          <div key={idx} className={`flex justify-between items-center p-2 rounded border transition-all ${
              isMe 
              ? 'bg-yellow-500/20 border-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.2)]'
              : amount > 0 
                  ? 'bg-yellow-900/10 border-yellow-500/20' 
                  : 'bg-white/5 border-white/5'
          }`}>
            <div className="flex items-center gap-2">
                <span className={`w-6 ${isMe ? 'text-yellow-400 font-bold' : 'text-gray-500'}`}>#{idx}</span>
                <span className={pirate?.alive ? (isMe ? 'text-white font-bold' : 'text-gray-300') : 'text-gray-600 line-through'}>
                    {isMe ? 'YOU' : pirate ? `${pirate.address.slice(0,6)}...${pirate.address.slice(-4)}` : 'Unknown'}
                </span>
            </div>
            <span className={amount > 0 ? "text-yellow-400 font-bold" : "text-gray-600"}>
                {amount.toFixed(1)} A
            </span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="bg-white/5 p-5 rounded-xl border border-white/10 space-y-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

      {/* Header */}
      <div className="flex justify-between items-center relative z-10">
        <span className="text-xs font-bold text-purple-400 uppercase tracking-widest flex items-center gap-2">
          <span>📜 Captain #{proposal.proposerIndex} Proposal</span>
        </span>
        
        {!isVoting ? (
            <div className="flex gap-4 text-xs font-mono font-bold">
            <span className="text-green-400 flex items-center gap-1">AYE: <span className="text-lg">{proposal.votesFor}</span></span>
            <span className="text-red-400 flex items-center gap-1">NAY: <span className="text-lg">{proposal.votesAgainst}</span></span>
            </div>
        ) : (
            <div className="badge badge-warning badge-outline font-bold animate-pulse">
                SECRET BALLOT IN PROGRESS
            </div>
        )}
      </div>

      {!isVoting && (
        <div className="w-full bg-gray-900 rounded-full h-3 overflow-hidden border border-white/5 flex">
            <div 
            className="h-full bg-green-500 shadow-[0_0_10px_green] transition-all duration-500"
            style={{ width: `${yesPercent}%` }}
            />
            <div 
            className="h-full bg-red-500 shadow-[0_0_10px_red] transition-all duration-500"
            style={{ width: `${noPercent}%` }}
            />
        </div>
      )}

      {/* Distribution List */}
          <div className="collapse collapse-arrow border border-white/5 bg-black/20 rounded-lg">
            <input type="checkbox" /> 
            <div className="collapse-title text-xs font-bold text-gray-400 uppercase tracking-wider">
            View Gold Distribution
            </div>
            <div className="collapse-content">
                {DistributionContent}
            </div>
          </div>
          </div>
  )
}