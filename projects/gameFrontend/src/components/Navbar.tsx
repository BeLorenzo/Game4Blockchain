import { useWallet } from '@txnlab/use-wallet-react'
import { Link, useLocation } from 'react-router-dom'
import { ConnectWallet } from './ConnectWallet'
import { KmdSwitcher } from './KmdSwitcher'
import { usePlayerStats } from '../hooks/usePlayerStats'

export const Navbar = () => {
  const { activeAddress } = useWallet()
  const { totalProfit } = usePlayerStats()
  const location = useLocation()
  
  // Capiamo se siamo nella sezione simulazione
  const isSimulation = location.pathname.startsWith('/simulation')

  return (
    <div className="navbar bg-black/50 backdrop-blur-md border-b border-white/5 sticky top-0 z-50 px-4 md:px-8">

      {/* SINISTRA: LOGO */}
      <div className="navbar-start">
        <Link to="/" className="btn btn-ghost normal-case text-xl p-0 hover:bg-transparent flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-primary to-accent flex items-center justify-center font-black text-black text-xs md:text-sm shadow-[0_0_15px_rgba(64,224,208,0.4)]">
            G4B
          </div>
          <span className="font-black tracking-tighter text-white hidden md:block text-lg">
            GAME<span className="text-primary">4</span>BLOCKCHAIN
          </span>
        </Link>
      </div>

      {/* CENTRO: MENU DI NAVIGAZIONE */}
      <div className="navbar-center hidden lg:flex">
        <ul className="menu menu-horizontal px-1 gap-2">
          <li>
            <Link 
              to="/" 
              className={!isSimulation ? 'bg-primary/10 text-primary font-bold' : 'text-gray-400 hover:text-white'}
            >
              🎮 Interactive
            </Link>
          </li>
          <li>
            <Link 
              to="/simulation" 
              className={isSimulation ? 'bg-accent/10 text-accent font-bold' : 'text-gray-400 hover:text-white'}
            >
              🤖 AI Simulation
            </Link>
          </li>
        </ul>
      </div>

      {/* DESTRA: STRUMENTI & WALLET */}
      <div className="navbar-end flex items-center gap-3">

        {/* Mostra P&L solo se connesso e NON in simulazione (o sempre se preferisci) */}
        {activeAddress && !isSimulation && (
            <div className={`hidden md:flex flex-col items-end px-3 py-1 rounded-lg border bg-black/40 ${totalProfit >= 0 ? 'border-green-900/50' : 'border-red-900/50'}`}>
                <span className="text-[9px] font-bold opacity-50 uppercase tracking-wider text-gray-400">Net P&L</span>
                <span className={`font-mono text-xs font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(2)} A
                </span>
            </div>
        )}

        {/* In Simulation Mode mostriamo un badge invece del wallet utente, o entrambi */}
        {isSimulation && (
           <div className="hidden md:flex badge badge-outline border-accent text-accent gap-2 p-3 mr-2">
             <span className="relative flex h-2 w-2">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
               <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
             </span>
             Observer Mode
           </div>
        )}

        <KmdSwitcher />
        <ConnectWallet />
      </div>
    </div>
  )
}