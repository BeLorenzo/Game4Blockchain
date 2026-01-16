// src/components/GameCard.tsx
import { ReactNode, useState } from 'react'

interface GameCardProps {
  title: string
  description: string
  icon: string
  appId: string
  rules: string[]
  children: ReactNode
}

export const GameCard = ({ title, description, icon, appId, rules, children }: GameCardProps) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    // items-start impedisce l'allungamento forzato della card vicina
    <div className="card bg-base-100 shadow-xl transition-all duration-300 self-start">
      <div className="card-body p-6">
        <div className="flex justify-between items-start cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
          <div className="flex items-center gap-4">
            <div className="text-4xl">{icon}</div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="card-title text-2xl">{title}</h2>
                <span className="text-[10px] opacity-40 font-mono">ID: {appId}</span>
              </div>
              <p className="text-sm text-gray-500">{description}</p>
            </div>
          </div>
          <button className="btn btn-ghost btn-circle btn-sm">{isOpen ? '−' : '+'}</button>
        </div>

        {isOpen && (
          <div className="mt-6 border-t border-base-200 pt-4">
            <div className="bg-base-200 rounded-lg p-3 mb-4 text-xs">
              <h4 className="font-bold mb-1 uppercase opacity-50">Regole</h4>
              <ul className="list-disc list-inside">
                {rules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
