import { useWallet } from '@txnlab/use-wallet-react'
import { ConnectWallet } from './ConnectWallet'
import { KmdSwitcher } from './KmdSwitcher'
import { usePlayerStats } from '../hooks/usePlayerStats'

export const Navbar = () => {
  const { activeAddress } = useWallet()
  const { totalProfit } = usePlayerStats(activeAddress)

  return (
    <div className="navbar bg-black/50 backdrop-blur-md border-b border-white/5 sticky top-0 z-50 px-4 md:px-8">

      {/* LATO SINISTRO: LOGO */}
      <div className="flex-1">
        <a className="btn btn-ghost normal-case text-xl p-0 hover:bg-transparent flex items-center gap-3">

          {/* 1. LOGO QUADRATO (G4B) - Sempre visibile */}
          {/* Ho aumentato leggermente w-10 h-10 per farci stare bene le 3 lettere */}
          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-primary to-accent flex items-center justify-center font-black text-black text-xs md:text-sm shadow-[0_0_15px_rgba(64,224,208,0.4)]">
            G4B
          </div>

          {/* 2. SCRITTA (GAME4BLOCKCHAIN) - Responsive */}
          {/* 'hidden': nasconde di default (mobile) */}
          {/* 'md:block': mostra dai schermi medi in su (tablet/desktop) */}
          <span className="font-black tracking-tighter text-white hidden md:block text-lg">
            GAME<span className="text-primary">4</span>BLOCKCHAIN
          </span>
        </a>
      </div>

      {/* LATO DESTRO: STRUMENTI */}
      <div className="flex-none flex items-center gap-3 md:gap-4">

        {/* STATS P&L (Visibile se connesso) */}
        {activeAddress && (
            <div className={`hidden md:flex flex-col items-end mr-2 px-3 py-1 rounded-lg border bg-black/40 ${totalProfit >= 0 ? 'border-green-900/50' : 'border-red-900/50'}`}>
                <span className="text-[9px] font-bold opacity-50 uppercase tracking-wider text-gray-400">Net P&L</span>
                <span className={`font-mono text-xs font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(2)} A
                </span>
            </div>
        )}

        {/* SWITCHER KMD (Solo LocalNet) */}
        <KmdSwitcher />

        {/* BOTTONE CONNESSIONE */}
        <ConnectWallet />
      </div>
    </div>
  )
}
