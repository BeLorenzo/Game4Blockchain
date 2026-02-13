import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/main.css'
import { NetworkId, WalletManager, WalletProvider, WalletId } from '@txnlab/use-wallet-react'
import { config } from './config'
import { TransactionToastProvider } from './context/TransactionToast'

import { Buffer } from 'buffer'
if (!window.Buffer) (window as any).Buffer = Buffer;

(BigInt.prototype as any).toJSON = function () {
  return this.toString()
}

/**
 * Network Environment Detection
 * Determines if the application is running on TestNet based on the centralized configuration.
 */
const isTestNet = config.algodConfig.network === 'testnet'

/**
 * Wallet Configuration
 * Defines the list of wallets supported by the application.
 * - Production/TestNet: Uses real wallets (Defly, Pera, Exodus).
 * - LocalNet: Adds KMD (Key Management Daemon) for local development without mobile apps.
 */
const supportedWallets = [
  WalletId.DEFLY,
  WalletId.PERA,
]

if (!isTestNet) {
  supportedWallets.push(WalletId.KMD)
}

/**
 * Wallet Manager Initialization
 * Configures the connection to the Algorand blockchain.
 * It maps the custom config values to the WalletManager's expected format.
 */
const walletManager = new WalletManager({
  wallets: supportedWallets,
  // Selects the appropriate NetworkId based on the environment
  network: isTestNet ? NetworkId.TESTNET : NetworkId.LOCALNET,
  algod: {
    token: config.algodConfig.token,
    baseServer: config.algodConfig.server,
    port: String(config.algodConfig.port),
  },
  options: {
    resetNetwork: true,
  },
} as any) 

console.log(`🌍 App running on: ${isTestNet ? 'TESTNET' : 'LOCALNET'}`)

/**
 * Application Rendering
 * Wraps the main App component with the WalletProvider to expose blockchain context.
 */
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <WalletProvider manager={walletManager}>
      <TransactionToastProvider>
      <App />
      </TransactionToastProvider>
    </WalletProvider>
)