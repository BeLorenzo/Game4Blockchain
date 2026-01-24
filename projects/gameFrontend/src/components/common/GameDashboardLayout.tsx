import React, { ReactNode } from 'react'

interface GameDashboardLayoutProps {
  title: string
  stats?: ReactNode
  createGameSection: ReactNode
  filters: ReactNode
  children: ReactNode
}

export const GameDashboardLayout: React.FC<GameDashboardLayoutProps> = ({ title, stats, createGameSection, filters, children }) => {
  return (
    <div className="space-y-8 pb-10">
      <div className="bg-white/5 p-6 rounded-xl border border-white/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none transition-all duration-500 group-hover:bg-primary/10"></div>

        <div className="flex flex-wrap justify-between items-center mb-8 relative z-10">
          <h4 className="font-black text-xl uppercase flex items-center gap-3 tracking-widest text-white">
            <span className="w-3 h-3 rounded-full bg-primary shadow-[0_0_10px_#40E0D0] animate-pulse"></span>
            {title}
          </h4>
          <div className="flex items-center gap-4">{stats}</div>
        </div>

        <div className="relative z-10">{createGameSection}</div>
      </div>

      {/* Tabs & Filters Bar */}
      <div className="flex flex-col xl:flex-row justify-between items-center gap-6 bg-black/20 p-3 rounded-2xl border border-white/5">
        {filters}
      </div>

      {/* Sessions List */}
      <div className="space-y-5 min-h-[200px]">{children}</div>
    </div>
  )
}
