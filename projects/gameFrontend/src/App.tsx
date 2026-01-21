// src/App.tsx
import { AlertProvider } from './context/AlertContext'
import { BlockchainStats } from './components/BlockchainStats'
import { GameCard } from './components/GameCard'
import { GuessGameDashboard } from './components/games/GuessGame/Dashboard'
import { Hero } from './components/Hero'
import { Navbar } from './components/Navbar'
import { config } from './config'

function App() {
  const { guessGame, rps, pirate } = config.games

  return (
    <AlertProvider>
      <div className="min-h-screen bg-[#050505] flex flex-col font-sans relative text-white selection:bg-primary selection:text-black">
        <Navbar />

        <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full space-y-12">

          {/* HERO SECTION */}
          <Hero />

          {/* BLOCKCHAIN STATS BAR */}
          <BlockchainStats />

          {/* GAMES GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

            {/* CARD 1: GUESS GAME (ACTIVE) */}
            <GameCard
              title={guessGame.name}
              icon={guessGame.icon}
              appId={guessGame.appId.toString()}
              description="Guess 2/3 of the average of all participants."
              rules={[
                'Choose a number between 0 and 100.',
                'Winner is closest to 2/3 of the average.',
                'Phases: Commit (Secret) -> Reveal (Public).',
              ]}
            >
              {guessGame.appId > 0n ? (
                <GuessGameDashboard />
              ) : (
                <div className="alert alert-error bg-red-900/20 border-red-500/20 text-red-200 text-xs font-mono flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <span>MISSING VITE_GUESSGAME_APP_ID in .env</span>
                </div>
              )}
            </GameCard>

            {/* CARD 2: RPS (COMING SOON) */}
            <GameCard
              title={rps.name}
              icon={rps.icon}
              appId={rps.appId > 0n ? rps.appId.toString() : 'N/A'}
              description="Rock Paper Scissors on-chain."
              rules={['Classic RPS mechanics.', 'Requires reveal to win.', 'Provably fair logic.']}
            >
              <div className="flex flex-col items-center justify-center py-12 opacity-30 border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                <span className="text-4xl mb-2 grayscale">🚧</span>
                <span className="font-mono text-xs font-bold uppercase tracking-widest">Coming Soon</span>
              </div>
            </GameCard>

            {/* CARD 3: PIRATE (COMING SOON) */}
            <GameCard
              title={pirate.name}
              icon={pirate.icon}
              appId={pirate.appId > 0n ? pirate.appId.toString() : 'N/A'}
              description="Democratic treasure distribution."
              rules={['Captain proposes split.', 'Crew votes.', 'Mutiny possible.']}
            >
               <div className="flex flex-col items-center justify-center py-12 opacity-30 border-2 border-dashed border-white/10 rounded-xl bg-white/5">
                <span className="text-4xl mb-2 grayscale">🏴‍☠️</span>
                <span className="font-mono text-xs font-bold uppercase tracking-widest">Coming Soon</span>
              </div>
            </GameCard>
          </div>
        </main>

        <footer className="footer footer-center p-8 border-t border-white/5 bg-black text-gray-500 text-xs font-mono">
          <div>
            <p className="opacity-60">© 2026 Game4Blockchain • Powered by Algorand</p>
          </div>
        </footer>
      </div>
    </AlertProvider>
  )
}

export default App
