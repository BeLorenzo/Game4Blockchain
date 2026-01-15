/* eslint-disable @typescript-eslint/no-explicit-any */
import { NetworkId, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Configurazione forzata con 'as any' per evitare blocchi TS inutili
const walletManager = new WalletManager({
  wallets: [WalletId.KMD, WalletId.DEFLY, WalletId.PERA, WalletId.KIBISIS, WalletId.EXODUS],
  network: NetworkId.LOCALNET,
  algod: {
    token: 'a'.repeat(64),
    baseServer: 'http://localhost',
    port: 4001,
  },
} as any)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WalletProvider manager={walletManager}>
      <App />
    </WalletProvider>
  </React.StrictMode>,
)
