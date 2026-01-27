import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/main.css'
import { NetworkId, WalletManager, WalletProvider, WalletId } from '@txnlab/use-wallet-react'
import { getAlgodConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'

const algodConfig = getAlgodConfigFromViteEnvironment()

const walletManager = new WalletManager({
  wallets: [
    WalletId.DEFLY,
    WalletId.PERA,
    WalletId.KMD,
  ],
  network: NetworkId.LOCALNET,
  algod: {
    token: algodConfig.token as string,
    baseServer: algodConfig.server,
    port: String(algodConfig.port),
  },
  options: {
    resetNetwork: true,
  }
} as any)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WalletProvider manager={walletManager}>
      <App />
    </WalletProvider>
  </React.StrictMode>,
)
