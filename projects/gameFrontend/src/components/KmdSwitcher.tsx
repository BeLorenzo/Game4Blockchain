import React from 'react'
import { useWallet } from '@txnlab/use-wallet-react'

export const KmdSwitcher = () => {
  const { wallets } = useWallet()

  const kmdWallet = wallets?.find((w) => w.id === 'kmd')

  if (!kmdWallet) return null

  if (!kmdWallet.isConnected) {
    return (
      <button className="btn btn-xs btn-outline btn-warning font-mono" onClick={() => kmdWallet.connect()}>
        🔌 CONNECT KMD
      </button>
    )
  }

  return (
    <div className="dropdown dropdown-end">
      <div
        tabIndex={0}
        role="button"
        className="btn btn-sm bg-black border border-warning/50 text-warning hover:bg-warning/10 font-mono text-[10px]"
      >
        <span className="w-2 h-2 rounded-full bg-warning animate-pulse mr-1"></span>
        DEV: KMD SWITCH
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content z-[1] menu p-2 shadow-2xl bg-black border border-white/10 rounded-box w-64 mt-1 max-h-80 overflow-y-auto"
      >
        <li className="menu-title text-xs text-gray-500 uppercase font-bold text-center">Select Dev Account</li>
        {kmdWallet.accounts.map((account) => (
          <li key={account.address}>
            <button
              className={`text-[10px] font-mono py-2 ${
                kmdWallet.activeAccount?.address === account.address
                  ? 'active bg-warning text-black font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
              onClick={() => kmdWallet.setActiveAccount(account.address)}
            >
              <div className="flex flex-col gap-0.5 text-left w-full overflow-hidden">
                <span>{account.name || 'Account'}</span>
                <span className="opacity-50 truncate">{account.address}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
