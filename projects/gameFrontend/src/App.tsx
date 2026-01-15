import { GameCard } from './components/GameCard'
import { GuessGameManager } from './components/GuessGameManager'
import { Hero } from './components/Hero'
import { Navbar } from './components/Navbar'

// ⚠️ INSERISCI QUI IL TUO APP ID ATTUALE
const GUESS_GAME_APP_ID = '1001' // <--- CAMBIA QUESTO con quello della CLI

function App() {
  return (
    <div className="min-h-screen bg-base-300 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <Hero />

        {/* GRIGLIA A DUE COLONNE */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CARD 1: GUESS GAME */}
          <GameCard
            title="Guess The Number"
            icon="🧠"
            appId={GUESS_GAME_APP_ID}
            description="Indovina i 2/3 della media."
            rules={[
              'Scegli un numero tra 0 e 100.',
              'Vince chi si avvicina ai 2/3 della media.',
              'Fee: 1 ALGO.',
              'Richiede fase di Commit e Reveal.',
            ]}
          >
            {/* Injectiamo il manager specifico dentro la card generica */}
            <GuessGameManager appId={GUESS_GAME_APP_ID} />
          </GameCard>

          {/* CARD 2: RPS (Placeholder) */}
          <GameCard
            title="Sasso Carta Forbice"
            icon="✂️"
            appId="Coming Soon"
            description="Il classico gioco a due giocatori."
            rules={['Commit segreto della mossa.', 'Vincitore prende tutto.', 'Timeout automatico.']}
          >
            <div className="text-center p-4 text-gray-500 italic">Contratto non ancora deployato.</div>
          </GameCard>

          {/* CARD 3: Placeholder per layout */}
          <GameCard
            title="Pirate Game"
            icon="🏴‍☠️"
            appId="Coming Soon"
            description="Distribuzione tesoro democratica."
            rules={['Regola 1', 'Regola 2']}
          >
            <div className="text-center p-4 text-gray-500 italic">Presto disponibile.</div>
          </GameCard>
        </div>
      </main>

      <footer className="footer footer-center p-4 bg-base-300 text-base-content text-xs opacity-50">
        <div>
          <p>Game4Blockchain Prototype</p>
        </div>
      </footer>
    </div>
  )
}

export default App
