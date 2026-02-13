import React from 'react'
import { PirateInfo } from '../../../hooks/Pirate/types' 

interface PirateCrewListProps {
  pirates: PirateInfo[]
  myAddress?: string
  currentProposerIndex: number
}

export const PirateCrewList: React.FC<PirateCrewListProps> = ({ pirates, myAddress, currentProposerIndex }) => {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-black/20">
      <div className="overflow-x-auto">
        <table className="table table-xs md:table-sm w-full">
          <thead>
            <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest font-mono">
              <th className="text-center w-12">Idx</th>
              <th>Pirate Address</th>
              <th className="text-center">Role</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {pirates.map((p) => {
              const isMe = p.address === myAddress
              const isCaptain = p.seniorityIndex === currentProposerIndex && p.alive
              const isDead = !p.alive

              return (
                <tr 
                  key={p.seniorityIndex} 
                  className={`
                    transition-all duration-200 border-b border-white/5 font-mono
                    ${isMe ? 'bg-primary/5 shadow-[inset_0_0_10px_rgba(64,224,208,0.05)]' : 'hover:bg-white/5'}
                    ${isDead ? 'opacity-30 grayscale' : 'opacity-100'}
                  `}
                >
                  {/* Index / Seniority */}
                  <td className="text-center font-bold text-gray-500">
                    #{p.seniorityIndex}
                  </td>

                  {/* Address */}
                  <td>
                    <div className="flex items-center gap-2">
                      <span className={isMe ? 'text-primary font-bold' : 'text-gray-300'}>
                        {p.address.slice(0, 6)}...{p.address.slice(-4)}
                      </span>
                      {isMe && <span className="badge badge-xs badge-primary badge-outline font-bold">ME</span>}
                    </div>
                  </td>

                  {/* Role (Captain Badge) */}
                  <td className="text-center">
                    {isCaptain && (
                      <span className="badge badge-sm badge-secondary font-bold shadow-[0_0_10px_#9333ea]">
                        🏴‍☠️ CAPTAIN
                      </span>
                    )}
                  </td>

                  {/* Status (Alive/Dead/Winner) */}
                  <td className="text-right font-bold text-[10px] tracking-wider uppercase">
                    {p.claimed ? (
                      <span className="text-green-400">💰 LOOTED</span>
                    ) : isDead ? (
                      <span className="text-red-500 decoration-red-500 line-through">ELIMINATED</span>
                    ) : (
                      <span className="text-blue-400">ALIVE</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}