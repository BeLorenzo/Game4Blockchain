// src/App.tsx
import { AlertProvider } from './context/AlertContext'
import { BlockchainStats } from './components/BlockchainStats'
import { GameCard } from './components/GameCard'
// Importa la nuova Dashboard invece del vecchio Manager
import { GuessGameDashboard } from './components/games/GuessGame/Dashboard'
import { Hero } from './components/Hero'
import { Navbar } from './components/Navbar'
import { config } from './config'

function App() {
  const { guessGame, rps, pirate } = config.games

  return (
    // 1. Il Provider avvolge tutto. Gestisce lui i Toast (pop-up errori/successo)
    <AlertProvider>
      <div className="min-h-screen bg-base-300 flex flex-col font-sans relative">
        <Navbar />

        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          <Hero />

          <BlockchainStats />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

            {/* CARD 1: GUESS GAME */}
            <GameCard
              title={guessGame.name}
              icon={guessGame.icon}
              appId={guessGame.appId.toString()}
              description="Indovina i 2/3 della media di tutti i partecipanti."
              rules={[
                'Scegli un numero tra 0 e 100.',
                'Vince chi si avvicina ai 2/3 della media calcolata.',
                'Fasi: Commit (segreto) -> Reveal (svelo).',
              ]}
            >
              {guessGame.appId > 0n ? (
                // 2. Nessuna prop necessaria: l'hook interno gestisce tutto
                <GuessGameDashboard />
              ) : (
                <div className="alert alert-warning text-xs font-mono">
                  ⚠️ VITE_GUESSGAME_APP_ID mancante nel file .env
                </div>
              )}
            </GameCard>

            {/* CARD 2: RPS (Placeholder) */}
            <GameCard
              title={rps.name}
              icon={rps.icon}
              appId={rps.appId > 0n ? rps.appId.toString() : 'N/A'}
              description="Sasso Carta Forbice on-chain."
              rules={['Classico gioco RPS.', 'Richiede reveal per vincere.']}
            >
              <div className="text-center p-4 text-gray-500 italic text-xs">
                Presto disponibile...
              </div>
            </GameCard>

             {/* CARD 3: PIRATE (Placeholder) */}
             <GameCard
              title={pirate.name}
              icon={pirate.icon}
              appId={pirate.appId > 0n ? pirate.appId.toString() : 'N/A'}
              description="Distribuzione democratica del tesoro."
              rules={['Il capitano propone.', 'La ciurma vota.']}
            >
              <div className="text-center p-4 text-gray-500 italic text-xs">
                Presto disponibile...
              </div>
            </GameCard>

          </div>
        </main>

        <footer className="footer footer-center p-4 bg-base-300 text-base-content text-[10px] opacity-40">
          <div>
            <p>© 2026 Game4Blockchain • Powered by Algorand</p>
          </div>
        </footer>
      </div>
    </AlertProvider>
  )
}

export default App
