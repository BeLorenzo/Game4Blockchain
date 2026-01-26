import { useState } from 'react'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { BlockchainStats } from './components/BlockchainStats'
import { GameCard } from './components/GameCard'
import { GuessGameDashboard } from './components/games/GuessGame/Dashboard'
import { RPSDashboard } from './components/games/RPS/Dashboard'
import { WeeklyGameDashboard } from './components/games/WeeklyGame/Dashboard'
import { StagHuntDashboard } from './components/games/StagHunt/Dashboard'
import { config } from './config'
import { PirateGameDashboard } from './components/games/PirateGame/Dashboard'

/**
 * 🎮 GAME REGISTRY
 *
 * Per aggiungere un nuovo gioco:
 * 1. Import il Dashboard component
 * 2. Aggiungi entry in questo array
 * 3. Done! Zero modifiche al resto del codice 🎉
 */
const GAMES = [
  {
    id: 'guess',
    config: config.games.guessGame,
    component: GuessGameDashboard,
    description: 'Guess 2/3 of the average.',
    rules: [
      'Choose a number (0-100).',
      'Winner is closest to 2/3 of average.',
      'Standard phases.',
    ],
    envVarName: 'VITE_GUESSGAME_APP_ID',
  },
  {
    id: 'rps',
    config: config.games.rps,
    component: RPSDashboard,
    description: 'Rock Paper Scissors Arena.',
    rules: [
      'Create a table or join one.',
      'Rock > Scissors > Paper.',
      'Winner takes the pot.',
    ],
    envVarName: 'VITE_RPS_APP_ID',
  },
  {
    id: 'weekly',
    config: config.games.weeklyGame,
    component: WeeklyGameDashboard,
    description: 'Decentralized Weekly Lottery.',
    rules: [
      'Buy a ticket to enter the pool.',
      'Winner selected randomly on-chain.',
      'Pot rolls over if no winner.',
    ],
    envVarName: 'VITE_WEEKLYGAME_APP_ID',
  },
  {
    id: 'staghunt',
    config: config.games.stagHunt,
    component: StagHuntDashboard,
    description: 'Coordination game - Hare or Stag?',
    rules: [
      'Choose Hare (safe refund) or Stag (risky).',
      'Stags win big if threshold is met.',
      'Failed rounds feed Global Jackpot.',
    ],
    envVarName: 'VITE_STAGHUNT_APP_ID',
  },
    {
    id: 'pirate',
    config: config.games.pirate,
    component: PirateGameDashboard,
    description: 'Sequential Bargaining Game',
    rules: [
      'Si va nel puzzo',
    ],
    envVarName: 'VITE_PIRATE_APP_ID',
  },
]

export const Home = () => {
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null)

  const handleToggle = (id: string) => {
    setExpandedGameId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full space-y-12">
        <Hero />
        <BlockchainStats />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start transition-all duration-300">
          {GAMES.map((game, index) => {
            const GameComponent = game.component
            const isExpanded = expandedGameId === game.id

            return (
              <div
                key={game.id}
                className={`${isExpanded ? 'lg:col-span-2' : ''}`}
                style={{ order: index + 1 }}
              >
                <GameCard
                  id={game.id}
                  title={game.config.name}
                  icon={game.config.icon}
                  appId={game.config.appId}
                  description={game.description}
                  rules={game.rules}
                  isActive={game.config.appId > 0n}
                  missingEnvText={game.envVarName}
                  isOpen={isExpanded}
                  onToggle={() => handleToggle(game.id)}
                >
                  <GameComponent />
                </GameCard>
              </div>
            )
          })}
        </div>
      </main>
      <footer className="footer footer-center p-8 border-t border-white/5 bg-black text-gray-600 text-xs font-mono">
        <div>
          <p>© 2026 Game4Blockchain • Powered by Algorand</p>
        </div>
      </footer>
    </div>
  )
}
