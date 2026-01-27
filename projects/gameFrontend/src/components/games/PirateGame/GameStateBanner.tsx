import React from 'react'
import { PirateGameSession } from '../../../hooks/Pirate/types'

export const GameStateBanner: React.FC<{ session: PirateGameSession }> = ({ session }) => {
  const { phase, rounds, pirates, alivePiratesCount } = session
  
  // CASE 1: Registration Timeout (Gioco fallito)
  // Fase è REGISTRATION ma il tempo è scaduto e non ci sono abbastanza pirati
  if (phase === 'REGISTRATION' && rounds.current >= rounds.start) {
    if (pirates.length < 3) {
      return (
        <div className="alert alert-warning shadow-lg border-orange-500/50 bg-orange-900/20 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div>
            <h3 className="font-bold">VOYAGE CANCELLED</h3>
            <div className="text-xs">Not enough pirates joined (Min 3). The ship won't sail.</div>
          </div>
        </div>
      )
    }
  }

  // CASE 2: Proposal Timeout (Capitano inerte)
  // Fase PROPOSAL ma tempo scaduto (usiamo endPhase che mappa endCommitAt per la proposal in usePirateGame)
  if (phase === 'PROPOSAL' && rounds.current > rounds.endPhase) {
    return (
      <div className="alert alert-error shadow-lg bg-red-900/20 border-red-500 mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <div>
          <h3 className="font-bold text-red-400">MUTINY! (TIMEOUT)</h3>
          <div className="text-xs">The Captain is sleeping. Any pirate can now execute a timeout to eliminate them.</div>
        </div>
      </div>
    )
  }

  // CASE 3: Last Pirate Standing
  // Se siamo in FINISHED e c'è solo 1 vivo, ha vinto automaticamente
  if (phase === 'FINISHED' && alivePiratesCount === 1) {
    const winner = pirates.find(p => p.alive)
    return (
      <div className="alert alert-success shadow-lg bg-green-900/20 border-green-500 mb-4">
        <div className="text-2xl">🏆</div>
        <div>
          <h3 className="font-bold text-green-400">LAST PIRATE STANDING</h3>
          <div className="text-xs">
            Pirate <span className="font-mono font-bold">{winner?.address.slice(0,6)}...</span> takes the entire pot!
          </div>
        </div>
      </div>
    )
  }

  return null
}