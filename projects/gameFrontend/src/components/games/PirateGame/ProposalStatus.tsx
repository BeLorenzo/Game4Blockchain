import React from 'react'
import { ProposalInfo, PirateInfo } from '../../../hooks/Pirate/types'

interface ProposalStatusProps {
  proposal: ProposalInfo | null
  pirates: PirateInfo[] // Serve per associare indice -> nome pirata
  aliveCount: number
}

export const ProposalStatus: React.FC<ProposalStatusProps> = ({ proposal, pirates, aliveCount }) => {
  if (!proposal) return null

  // Calcolo Percentuali Consenso (stima basata su voti rivelati)
  const totalVotesCast = proposal.votesFor + proposal.votesAgainst
  // Soglia per vincere: > 50% dei vivi (o >= a seconda delle regole precise, qui assumiamo maggioranza stretta)
  const threshold = Math.floor(aliveCount / 2) + 1 
  
  const approvalRate = totalVotesCast > 0 
    ? (proposal.votesFor / totalVotesCast) * 100 
    : 0

  return (
    <div className="bg-white/5 p-5 rounded-xl border border-white/10 space-y-4 relative overflow-hidden">
      {/* Background glow sottile */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

      {/* Header Proposta */}
      <div className="flex justify-between items-center relative z-10">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <span>📜 Proposal from Captain #{proposal.proposerIndex}</span>
        </span>
        <div className="flex gap-4 text-xs font-mono font-bold">
          <span className="text-green-400 flex items-center gap-1">
            AYE: <span className="text-lg">{proposal.votesFor}</span>
          </span>
          <span className="text-red-400 flex items-center gap-1">
            NAY: <span className="text-lg">{proposal.votesAgainst}</span>
          </span>
        </div>
      </div>

      {/* Progress Bar Consenso */}
      <div className="w-full bg-gray-900 rounded-full h-3 overflow-hidden border border-white/5 relative">
        <div 
          className={`h-full transition-all duration-500 ${approvalRate >= 50 ? 'bg-green-500 shadow-[0_0_10px_green]' : 'bg-red-500 shadow-[0_0_10px_red]'}`}
          style={{ width: `${approvalRate}%` }}
        />
        {/* Linea di maggioranza */}
        <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-white/50 dashed" title="Majority Threshold" />
      </div>

      {/* Tabella Distribuzione (Collapsible) */}
      <div className="collapse collapse-arrow border border-white/5 bg-black/20 rounded-lg">
        <input type="checkbox" /> 
        <div className="collapse-title text-xs font-bold text-gray-400 uppercase tracking-wider">
          View Gold Distribution ({proposal.distribution.reduce((a,b)=>a+b, 0)} ALGO)
        </div>
        <div className="collapse-content">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono mt-2">
            {proposal.distribution.map((amount, idx) => (
              // Mostra solo chi riceve qualcosa o è vivo
              (amount > 0 || pirates[idx]?.alive) && (
                <div key={idx} className={`flex justify-between p-2 rounded border ${amount > 0 ? 'bg-yellow-900/20 border-yellow-500/30' : 'bg-white/5 border-white/5'}`}>
                  <span className="text-gray-400">Pirate #{idx}</span>
                  <span className={amount > 0 ? "text-yellow-400 font-bold" : "text-gray-600"}>{amount} A</span>
                </div>
              )
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}