/* eslint-disable prettier/prettier */
import { useWallet } from '@txnlab/use-wallet-react'
import { KmdSwitcher } from './KmdSwitcher'
import { usePlayerStats } from '../hooks/usePlayerStats' // <--- Importa Hook

export const Navbar = () => {
  const { activeAddress, wallets } = useWallet()
  const { totalProfit } = usePlayerStats(activeAddress) // <--- Usa Hook

  const truncate = (str: string) => `${str.slice(0, 4)}...${str.slice(-4)}`

  return (
    <div className="navbar bg-base-100 shadow-lg px-4 sticky top-0 z-50">
      <div className="flex-1">
        <div className="flex flex-col">
           <span className="normal-case text-xl text-primary font-bold">Game4Blockchain 🎮</span>
        </div>
      </div>

      <div className="flex-none flex items-center gap-2">

        {/* P&L GLOBALE (Visibile solo se connesso) */}
        {activeAddress && (
            <div className={`hidden md:flex flex-col items-end mr-4 px-2 py-1 rounded bg-base-200/50 border ${totalProfit >= 0 ? 'border-success/20' : 'border-error/20'}`}>
                <span className="text-[10px] font-bold opacity-50 uppercase">Net P&L</span>
                <span className={`font-mono text-sm font-bold ${totalProfit >= 0 ? 'text-success' : 'text-error'}`}>
                    {totalProfit > 0 ? '+' : ''}{totalProfit.toFixed(2)} A
                </span>
            </div>
        )}

        <KmdSwitcher />

        {activeAddress ? (
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-outline btn-success btn-sm m-1 font-mono">
              {truncate(activeAddress)}
            </label>
            <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-200 rounded-box w-52">
              <li className="menu-title">
                <span>Connesso con</span>
              </li>
              {wallets
                ?.filter((w) => w.isActive)
                .map((w) => (
                  <li key={w.id}>
                    <a className="active">{w.metadata.name}</a>
                  </li>
                ))}
              <div className="divider my-0"></div>
              <li>
                <a onClick={() => wallets?.find((w) => w.isActive)?.disconnect()} className="text-error">
                  Disconnetti
                </a>
              </li>
            </ul>
          </div>
        ) : (
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-primary btn-sm m-1">
              Connetti Wallet
            </label>
            <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-200 rounded-box w-52">
              {wallets?.map((wallet) => (
                <li key={wallet.id}>
                  <a onClick={() => wallet.connect()}>
                    <img src={wallet.metadata.icon} alt={wallet.metadata.name} className="w-5 h-5" />
                    {wallet.metadata.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
