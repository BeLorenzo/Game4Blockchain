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
 * GAME REGISTRY
 * 
 * Central configuration registry for all available blockchain games.
 * 
 * To add a new game:
 * 1. Import the game's Dashboard component
 * 2. Add an entry to this array with the required properties
 * 3. The game will automatically appear in the UI with proper layout and functionality
 */
const GAMES = [
  {
    id: 'guess',
    config: config.games.guessGame,
    component: GuessGameDashboard,
    description: 'Guess 2/3 of the average',
    rules: [
      'Pick a number between 0 and 100.',
      'Target is 2/3 of the global average.',
      'Closest guess takes the entire pot.',
    ],
    envVarName: 'VITE_GUESSGAME_APP_ID',
  },
  {
    id: 'rps',
    config: config.games.rps,
    component: RPSDashboard,
    description: 'PvP Arena: Rock, Paper, Scissors.',
    rules: [
      'Challenge a player or join an open table.',
      'Moves are hidden until both commit.',
      'Winner takes the opponent\'s bet.',
    ],
    envVarName: 'VITE_RPS_APP_ID',
  },
  {
    id: 'weekly',
    config: config.games.weeklyGame,
    component: WeeklyGameDashboard,
    description: 'Minority Game / Crowd Avoidance.', 
    rules: [
      'Pick a day. Pot is split evenly among ACTIVE days.',
      'Example: 2 active days = 50% of Pot each.',
      'Fewer people on your day = BIGGER cut for you.',
    ],
    envVarName: 'VITE_WEEKLYGAME_APP_ID',
  },
  {
    id: 'staghunt',
    config: config.games.stagHunt,
    component: StagHuntDashboard,
    description: 'Coordination Game: Trust vs Safety.',
    rules: [
      'Hunt Stag (High Risk) or Hare (Safe Refund).',
      'Stag requires a % of players to succeed.',
      'If coordination fails, Stag hunters lose fees.',
    ],
    envVarName: 'VITE_STAGHUNT_APP_ID',
  },
  {
    id: 'pirate',
    config: config.games.pirate,
    component: PirateGameDashboard,
    description: 'Sequential Bargaining & Mutiny.',
    rules: [
      'Oldest Pirate (Captain) proposes a pot split.',
      'All pirates vote. Votes are hidden until reveal.',
      'If ≥ 50% agree: Proposal passes, game ends.',
      'If rejected: Captain is ELIMINATED (Killed).',
      'Next pirate becomes Captain. Cycle repeats.',
    ],
    envVarName: 'VITE_PIRATE_APP_ID',
  },
]

/**
 * Home Component
 * 
 * Main application component that renders the game selection interface.
 * 
 * Features:
 * - Responsive grid layout for game cards
 * - Expandable/collapsible game dashboards
 * - Automatic ordering of game cards
 * - Integration with blockchain statistics display
 */
export const Home = () => {
  /**
   * State tracking which game card is currently expanded.
   */
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null)

  /**
   * Handles toggling the expansion state of a game card.
   * 
   * If the clicked game is already expanded, collapses it.
   * If a different game is clicked, expands it and collapses any other expanded game.
   */
  const handleToggle = (id: string) => {
    // Toggle expansion: if already expanded, collapse; otherwise expand this game
    setExpandedGameId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="flex flex-col min-h-screen">
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
                {/* 
                  GameCard component handles the collapsible UI container
                  GameComponent renders the actual game dashboard inside
                */}
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
                  {/* Render the game-specific dashboard component */}
                  <GameComponent />
                </GameCard>
              </div>
            )
          })}
        </div>
      </main>
      {/* Application footer */}
      <footer className="footer footer-center p-8 border-t border-white/5 bg-black text-gray-600 text-xs font-mono">
        <div>
          <p>© 2026 Game4Blockchain • Powered by Algorand</p>
        </div>
      </footer>
    </div>
  )
}