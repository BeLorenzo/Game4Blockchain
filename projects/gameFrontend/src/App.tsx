import { BlockchainStats } from './components/BlockchainStats'
import { GameCard } from './components/GameCard'
import { GuessGameManager } from './components/GuessGameManager'
import { Hero } from './components/Hero'
import { Navbar } from './components/Navbar'
import { config } from './config'

function App() {
  const { guessGame, rps, pirate } = config.games

  return (
    <div className="min-h-screen bg-base-300 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <Hero />

        {/* Punto 6: Statistiche Globali (Round, etc.) */}
        <BlockchainStats />

        {/* Punto 2: Griglia con items-start per evitare allineamenti forzati */}
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
              'Richiede una fase di Commit (segreto) e una di Reveal.',
              'Deposito MBR richiesto per lo storage delle sessioni.',
            ]}
          >
            {guessGame.appId > 0n ? (
              <GuessGameManager />
            ) : (
              <div className="alert alert-warning text-xs font-mono">⚠️ VITE_GUESSGAME_APP_ID mancante nel file .env</div>
            )}
          </GameCard>

          {/* CARD 2: RPS */}
          <GameCard
            title={rps.name}
            icon={rps.icon}
            appId={rps.appId > 0n ? rps.appId.toString() : 'Coming Soon'}
            description="Il classico gioco Sasso-Carta-Forbice on-chain."
            rules={['Puntata minima variabile.', 'Reveal obbligatorio per non perdere la posta.']}
          >
            <div className="text-center p-4 text-gray-500 italic text-xs">
              {rps.appId > 0n ? 'Manager in arrivo...' : 'Contratto non ancora configurato.'}
            </div>
          </GameCard>

          {/* CARD 3: PIRATE GAME */}
          <GameCard
            title={pirate.name}
            icon={pirate.icon}
            appId={pirate.appId > 0n ? pirate.appId.toString() : 'Coming Soon'}
            description="Distribuzione democratica del tesoro tra pirati."
            rules={['Votazione basata sulla gerarchia.', 'Il capitano propone, gli altri decidono.']}
          >
            <div className="text-center p-4 text-gray-500 italic text-xs">Presto disponibile.</div>
          </GameCard>
        </div>
      </main>

      <footer className="footer footer-center p-4 bg-base-300 text-base-content text-[10px] opacity-40">
        <div>
          <p>© 2026 Game4Blockchain • Powered by Algorand</p>
        </div>
      </footer>
    </div>
  )
}

export default App
