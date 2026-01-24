import React, { ReactNode } from 'react'

interface BaseSessionCardProps {
  id: number
  isEnded: boolean
  isWinner?: boolean
  borderColorClass?: string
  children: ReactNode
}

export const BaseSessionCard: React.FC<BaseSessionCardProps> = ({ id, isEnded, borderColorClass = 'border-white/5', children }) => {
  const cardBg = isEnded ? 'bg-[#0F0F0F]' : 'bg-[#151515]'

  return (
    <div
      className={`collapse collapse-arrow rounded-xl border transition-all duration-300 ${cardBg} ${borderColorClass} ${isEnded ? 'opacity-90' : 'opacity-100'}`}
    >
      <input type="checkbox" />
      {children}
    </div>
  )
}

export const SessionCardHeader = ({ children }: { children: ReactNode }) => <div className="collapse-title p-5 pr-12">{children}</div>

export const SessionCardBody = ({ isEnded, children }: { isEnded: boolean; children: ReactNode }) => (
  <div className={`collapse-content ${isEnded ? 'bg-[#0a0a0a]' : 'bg-[#1a1a1a]/50'}`}>
    <div className="pt-6 space-y-6">{children}</div>
  </div>
)
