import React from 'react'

interface GameCardProps {
  id: string
  title: string
  icon: string
  description: string
  rules: string[]
  isActive: boolean
  missingEnvText: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
  appId?: bigint | number
}

export const GameCard: React.FC<GameCardProps> = ({
  title,
  icon,
  description,
  rules,
  isActive,
  missingEnvText,
  isOpen,
  onToggle,
  children,
  appId,
}) => {
  return (
    <div
      className={`relative w-full rounded-2xl border transition-all duration-300 overflow-hidden ${
        isActive
          ? 'bg-[#111] border-white/10 shadow-xl hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]'
          : 'bg-black/40 border-white/5 opacity-60 grayscale'
      }`}
    >
      {/* Header Cliccabile */}
      <div
        onClick={isActive ? onToggle : undefined}
        className={`p-6 md:p-8 flex items-start gap-6 cursor-pointer relative z-10 ${!isActive && 'cursor-not-allowed'}`}
      >
        <div className={`text-5xl md:text-6xl filter drop-shadow-lg transition-transform duration-300 ${isOpen ? 'scale-110' : 'group-hover:scale-105'}`}>
          {icon}
        </div>

        {/* Grid Layout per contenuto a sinistra + badge ID a destra */}
        <div className="flex-1 grid grid-cols-[1fr_auto] gap-4 items-start min-h-[80px]">
          {/* Colonna sinistra: Titolo + Descrizione */}
          <div className="space-y-2">
            <h2 className={`text-2xl md:text-3xl font-black uppercase tracking-wider ${isActive ? 'text-white' : 'text-gray-600'}`}>
              {title}
            </h2>

            <p className="text-sm text-gray-400 font-medium leading-relaxed max-w-xl">
              {description}
            </p>

            {!isActive && (
              <div className="text-[10px] text-red-900/60 font-mono mt-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-red-900 rounded-full animate-pulse"></span>
                MISSING CONFIG: {missingEnvText}
              </div>
            )}
          </div>

          {/* Colonna destra: Chevron + Badge ID */}
          <div className="flex flex-col items-end justify-between h-full min-h-[80px]">
            {/* Chevron/Status in alto */}
            <div className="flex items-center gap-3">
              {!isActive ? (
                <span className="badge badge-error badge-outline font-bold text-[10px] tracking-widest opacity-70">OFFLINE</span>
              ) : (
                <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : 'rotate-0'}`}>
                  <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              )}
            </div>

            {/* Badge ID in basso a destra */}
            {isActive && !!appId && (
              <div className="mt-auto">
                <span className="inline-block px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] font-mono text-gray-500">
                  ID: {appId.toString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content (Dashboard) */}
      <div
        className={`transition-all duration-500 ease-in-out overflow-hidden border-t border-white/5 bg-black/20 ${
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="p-6 md:p-8">
          {/* Rules Section */}
          <div className="mb-8 flex flex-wrap gap-2 text-[10px] uppercase font-bold tracking-widest text-gray-500">
            {rules.map((rule, i) => (
              <span key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
                <span className="text-primary">•</span> {rule}
              </span>
            ))}
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}
