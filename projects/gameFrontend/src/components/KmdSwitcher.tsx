import React from 'react'
import { useWallet } from '@txnlab/use-wallet-react'

export const KmdSwitcher = () => {
  const { activeWallet, activeAddress, wallets } = useWallet()

  // Trova il wallet KMD tra quelli disponibili
  const kmdWallet = wallets?.find(w => w.id === 'kmd')

  // Mostra solo se siamo connessi al provider KMD
  if (!activeWallet || activeWallet.id !== 'kmd' || !kmdWallet) {
    return null
  }

  return (
    <div className="flex flex-col items-end mr-2">
      <span className="text-[10px] font-bold opacity-50 uppercase tracking-wider">
        SIMULAZIONE LOCALE
      </span>
      <select
        className="select select-bordered select-xs w-40 font-mono text-xs"
        // FIX ERRORE TYPE: Se activeAddress è null, usiamo stringa vuota
        value={activeAddress || ''}
        onChange={(e) => {
            if (e.target.value) {
                kmdWallet.setActiveAccount(e.target.value)
            }
        }}
      >
        {kmdWallet.accounts.map((account, index) => (
          <option key={account.address} value={account.address}>
            Player {index + 1} ({account.address.slice(0, 3)}..{account.address.slice(-3)})
          </option>
        ))}
      </select>
    </div>
  )
}
