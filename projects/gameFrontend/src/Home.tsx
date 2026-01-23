import { useState } from 'react'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { BlockchainStats } from './components/BlockchainStats'
import { GameCard } from './components/GameCard'
import { GuessGameDashboard } from './components/games/GuessGame/Dashboard'
import { config } from './config'
import { RPSDashboard } from './components/games/RPS/Dashboard'

export const Home = () => {
  const { guessGame, rps, pirate } = config.games

  // Gestisce quale gioco è aperto
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null)

  const handleToggle = (id: string) => {
    // Se clicco sullo stesso già aperto, chiudo (null). Altrimenti apro il nuovo.
    setExpandedGameId(prev => prev === id ? null : id)
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />

      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full space-y-12">
        <Hero />
        <BlockchainStats />

        {/* GRIGLIA REATTIVA */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start transition-all duration-300">

          {/* GUESS GAME */}
          <div className={`${expandedGameId === 'guess' ? 'lg:col-span-2 order-1' : 'order-1'}`}>
            <GameCard
              id="guess"
              title={guessGame.name}
              icon={guessGame.icon}
              description="Guess 2/3 of the average of all participants."
              rules={['Choose a number (0-100).', 'Winner is closest to 2/3 of average.', 'Phases: Commit (Secret) -> Reveal.']}
              isActive={guessGame.appId > 0n}
              missingEnvText="VITE_GUESSGAME_APP_ID"
              isOpen={expandedGameId === 'guess'}
              onToggle={() => handleToggle('guess')}
            >
              <GuessGameDashboard />
            </GameCard>
          </div>

          {/* RPS */}
      <div className={`${expandedGameId === 'rps' ? 'lg:col-span-2 order-2' : 'order-2'}`}>
        <GameCard
          id="rps"
          title={rps.name}
          icon={rps.icon}
          description="Rock Paper Scissors on-chain."
          rules={['Choose: Rock, Paper or Scissors.', 'Pay the wager to create a fight.', 'Winner takes all (Standard rules).']}
          // ATTENZIONE: Assicurati che l'App ID sia > 0 nel config, o metti true per testare la grafica
          isActive={rps.appId > 0n || true}
          missingEnvText="VITE_RPS_APP_ID"
          // Rimuoviamo il coming soon
          isComingSoon={false}
          isOpen={expandedGameId === 'rps'}
          onToggle={() => handleToggle('rps')}
        >
          {/* Ecco il nostro nuovo componente! */}
          <RPSDashboard />
        </GameCard>
      </div>

          {/* PIRATE (Coming Soon) */}
          <div className={`${expandedGameId === 'pirate' ? 'lg:col-span-2 order-3' : 'order-3'}`}>
            <GameCard
              id="pirate"
              title={pirate.name}
              icon={pirate.icon}
              description="Democratic treasure distribution."
              rules={['Captain proposes split.', 'Crew votes.', 'Mutiny possible.']}
              isActive={false}
              isComingSoon={true}
              isOpen={expandedGameId === 'pirate'}
              onToggle={() => handleToggle('pirate')}
            />
          </div>
        </div>
      </main>

      <footer className="footer footer-center p-8 border-t border-white/5 bg-black text-gray-600 text-xs font-mono">
        <div><p>© 2026 Game4Blockchain • Powered by Algorand</p></div>
      </footer>
    </div>
  )
}
