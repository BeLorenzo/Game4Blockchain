import React, { ReactNode } from 'react'

interface GameCardProps {
  id: string
  title: string
  icon: string
  description: string
  rules: string[]
  children?: ReactNode
  isActive?: boolean
  isComingSoon?: boolean
  missingEnvText?: string
  isOpen: boolean       // Stato esterno
  onToggle: () => void  // Azione esterna
}

export const GameCard: React.FC<GameCardProps> = ({
  title,
  icon,
  description,
  rules,
  children,
  isActive = true,
  isComingSoon = false,
  missingEnvText,
  isOpen,
  onToggle
}) => {
  return (
    <div
      className={`card bg-[#111] border shadow-xl overflow-hidden transition-all duration-500 ease-in-out ${
        isOpen ? 'border-primary/50 shadow-[0_0_30px_rgba(64,224,208,0.15)]' : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="card-body p-6">
        {/* Header (Titolo e Icona) sempre visibili */}
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-4 mb-4">
            <div className={`text-4xl bg-white/5 p-3 rounded-xl border transition-colors ${isOpen ? 'border-primary/30 text-primary' : 'border-white/5'}`}>
              {icon}
            </div>
            <div>
              <h2 className="card-title text-2xl font-black text-white tracking-wide">{title}</h2>
              {isComingSoon && <div className="badge badge-warning badge-outline text-[10px] font-bold uppercase mt-1">Coming Soon</div>}
            </div>
          </div>

          {/* Tasto Chiudi (X) visibile solo se aperto */}
          {isOpen && (
            <button onClick={onToggle} className="btn btn-sm btn-circle btn-ghost text-gray-500 hover:text-white">✕</button>
          )}
        </div>

        {/* STATO CHIUSO: Mostra Info e Tasto Play */}
        {!isOpen && (
          <div className="animate-fade-in">
            <p className="text-gray-400 text-sm mb-6 leading-relaxed min-h-[40px]">{description}</p>

            <div className="bg-black/30 p-4 rounded-lg border border-white/5 mb-6">
              <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Mechanics</h3>
              <ul className="text-xs text-gray-400 space-y-2 font-mono">
                {rules.map((rule, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-primary">•</span> {rule}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-auto pt-2">
              {isComingSoon ? (
                <button disabled className="btn btn-block btn-disabled bg-white/5 border-0 text-gray-600 font-mono tracking-widest">
                  COMING SOON
                </button>
              ) : isActive ? (
                <button
                  onClick={onToggle}
                  className="btn btn-block btn-primary text-black font-black tracking-widest shadow-[0_0_20px_rgba(64,224,208,0.2)] hover:scale-[1.02] transition-transform"
                >
                  PLAY NOW
                </button>
              ) : (
                <div className="alert alert-error bg-red-900/10 border-red-500/20 text-red-300 text-xs font-mono flex items-center gap-3">
                  <span>MISSING CONFIG: {missingEnvText}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STATO APERTO: Mostra la Dashboard */}
        {isOpen && isActive && !isComingSoon && (
          <div className="mt-4 animate-fade-in border-t border-white/5 pt-6">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
