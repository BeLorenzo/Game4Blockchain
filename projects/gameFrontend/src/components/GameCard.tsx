import React, { ReactNode, useState } from 'react'

interface GameCardProps {
  title: string
  icon: string
  description: string
  appId: string
  rules: string[]
  children: ReactNode
}

export const GameCard: React.FC<GameCardProps> = ({ title, icon, description, appId, rules, children }) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className={`card bg-base-200 shadow-xl transition-all duration-300 border border-base-content/5 ${isOpen ? 'col-span-1 md:col-span-2' : ''}`}>
      <div className="card-body p-5">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-4">
            <span className="text-4xl filter drop-shadow-md">{icon}</span>
            <div>
              <h2 className="card-title text-xl font-bold">{title}</h2>
              <div className="badge badge-ghost badge-xs font-mono opacity-50">AppID: {appId}</div>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`btn btn-sm ${isOpen ? 'btn-neutral' : 'btn-ghost'}`}
          >
            {isOpen ? 'Chiudi Dashboard' : 'Apri Gioco'}
          </button>
        </div>

        <p className="text-sm mt-3 opacity-80 border-l-2 border-primary pl-3 italic">
          {description}
        </p>

        {isOpen && (
          <div className="mt-6 animate-in fade-in slide-in-from-top-4 duration-500">
            {/* Sezione Regole */}
            <div className="bg-base-300/50 rounded-xl p-4 text-xs mb-6 border border-base-content/5">
              <h3 className="font-bold mb-2 uppercase tracking-wide opacity-60">Regole del Gioco</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {rules.map((rule, idx) => (
                  <li key={idx} className="flex gap-2 items-start">
                    <span className="text-primary">•</span> {rule}
                  </li>
                ))}
              </ul>
            </div>

            {/* Qui viene iniettata la Dashboard specifica */}
            <div className="divider text-xs font-mono opacity-50">CONSOLE DI GIOCO</div>
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
