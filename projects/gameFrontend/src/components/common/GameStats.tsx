import React from 'react'

interface GameStatsProps {
  totalProfit: number
  mbr: number
}

export const GameStats: React.FC<GameStatsProps> = ({ totalProfit, mbr }) => {
  return (
    <>
      <div className={`px-4 py-2 rounded-lg border font-mono font-bold text-sm shadow-lg backdrop-blur-md ${totalProfit >= 0 ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
        P&L: {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(2)} A
      </div>
      <div className="text-xs font-mono font-bold text-gray-500 bg-black/50 px-3 py-2 rounded border border-white/5">
        MBR: {mbr.toFixed(3)} A
      </div>
    </>
  )
}
