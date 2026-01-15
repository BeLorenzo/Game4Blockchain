import { ReactNode, useState } from 'react'

interface GameCardProps {
  title: string
  description: string
  icon: string // Emoji o icona
  appId: string
  rules: string[]
  children: ReactNode // Qui ci finisce la dashboard specifica del gioco
}

export const GameCard = ({ title, description, icon, appId, rules, children }: GameCardProps) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className={`card bg-base-100 shadow-xl border border-base-200 transition-all duration-300 ${isOpen ? 'row-span-2' : ''}`}>
      <div className="card-body p-6">
        {/* HEADER: Titolo e Descrizione */}
        <div className="flex justify-between items-start cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
          <div className="flex items-center gap-4">
            <div className="text-4xl">{icon}</div>
            <div>
              <h2 className="card-title text-2xl">{title}</h2>
              <p className="text-sm text-gray-500">{description}</p>
            </div>
          </div>
          <button className="btn btn-ghost btn-circle btn-sm">{isOpen ? '▲' : '▼'}</button>
        </div>

        {/* CONTENUTO A SCOMPARSA */}
        {isOpen && (
          <div className="mt-6 animate-fade-in">
            <div className="divider my-2"></div>

            {/* Sezione Regole e Info Tecniche (Piccole) */}
            <div className="collapse collapse-plus bg-base-200 mb-4 rounded-lg">
              <input type="checkbox" />
              <div className="collapse-title text-sm font-medium text-gray-500">📜 Regole & Dettagli Tecnici (App ID: {appId})</div>
              <div className="collapse-content text-xs text-gray-600">
                <ul className="list-disc list-inside space-y-1 mb-2">
                  {rules.map((rule, idx) => (
                    <li key={idx}>{rule}</li>
                  ))}
                </ul>
                <div className="badge badge-outline badge-xs opacity-50">App ID: {appId}</div>
              </div>
            </div>

            {/* QUI C'È IL CUORE: Dashboard e Azioni specifiche del gioco */}
            <div className="bg-base-200/50 rounded-xl p-4 border border-base-300">{children}</div>
          </div>
        )}
      </div>
    </div>
  )
}
