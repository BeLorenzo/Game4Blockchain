import { useWallet } from '@txnlab/use-wallet-react'
import { useState } from 'react'
import { createPortal } from 'react-dom' // <--- IMPORTANTE
import { ellipseAddress } from '../utils/ellipseAddress'

export const ConnectWallet = () => {
  const { wallets, activeAddress } = useWallet()
  const [isOpen, setIsOpen] = useState(false)

  const handleDisconnect = () => {
    wallets?.find((w) => w.isActive)?.disconnect()
    setIsOpen(false)
  }

  // Contenuto della Modale (estratto per pulizia)
  const modalContent = (
    <dialog className={`modal modal-bottom sm:modal-middle ${isOpen ? 'modal-open' : ''}`} style={{ zIndex: 99999 }}>
      <div className="modal-box bg-[#111] border border-white/10 rounded-xl relative shadow-[0_0_50px_rgba(0,0,0,0.8)]">
        <button
          className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2 text-gray-500 hover:text-white"
          onClick={() => setIsOpen(false)}
        >
          ✕
        </button>

        <h3 className="font-black text-lg text-white mb-6 uppercase tracking-widest flex items-center gap-2">
          <span className="w-2 h-2 bg-primary rounded-full shadow-[0_0_10px_#40E0D0]"></span>
          Select Wallet
        </h3>

        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          {wallets
            ?.filter((w) => w.id !== 'kmd') // Nascondiamo KMD (lo usiamo dallo switcher)
            .map((wallet) => (
            <button
              key={wallet.id}
              className="btn btn-outline justify-start h-16 border-white/10 hover:border-primary hover:bg-primary/10 hover:text-white group transition-all"
              onClick={() => {
                wallet.connect()
                setIsOpen(false)
              }}
            >
              {wallet.metadata.icon ? (
                <img
                  src={wallet.metadata.icon}
                  alt={wallet.metadata.name}
                  className="w-8 h-8 mr-4 grayscale group-hover:grayscale-0 transition-all object-contain"
                />
              ) : (
                <div className="w-8 h-8 mr-4 bg-gray-800 rounded flex items-center justify-center font-bold text-xs text-white">
                  {wallet.metadata.name.substring(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col items-start">
                <span className="font-bold tracking-wide text-sm">{wallet.metadata.name}</span>
                <span className="text-[10px] text-gray-500 font-mono group-hover:text-primary/70">Click to connect</span>
              </div>
            </button>
          ))}

          {(!wallets || wallets.filter(w => w.id !== 'kmd').length === 0) && (
             <div className="text-center text-gray-500 text-xs font-mono py-8 border border-dashed border-white/10 rounded bg-white/5">
               No external wallets found.
             </div>
          )}
        </div>

        <div className="divider my-4 before:bg-white/5 after:bg-white/5"></div>

        <p className="text-[10px] text-center text-gray-600 font-mono">
          Powered by Algorand
        </p>
      </div>

      {/* Backdrop che chiude al click */}
      <div className="modal-backdrop bg-black/80 backdrop-blur-sm" onClick={() => setIsOpen(false)}></div>
    </dialog>
  )

  // 1. SE CONNESSO: Mostra dropdown
  if (activeAddress) {
    return (
      <div className="dropdown dropdown-end">
        <div tabIndex={0} role="button" className="btn btn-sm btn-outline btn-primary font-mono tracking-wider">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse mr-2"></div>
          {ellipseAddress(activeAddress)}
        </div>
        <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-2xl bg-black border border-white/10 rounded-box w-52 mt-2">
          <li>
            <button className="text-error font-bold text-xs hover:bg-white/5" onClick={handleDisconnect}>
              DISCONNECT WALLET
            </button>
          </li>
        </ul>
      </div>
    )
  }

  // 2. SE DISCONNESSO: Bottone + Modale (Portal)
  return (
    <>
      <button
        className="btn btn-sm btn-primary text-black font-black tracking-widest hover:scale-105 transition-transform"
        onClick={() => setIsOpen(true)}
      >
        CONNECT WALLET
      </button>

      {/* MAGIA: Sposta la modale fuori dalla Navbar, direttamente nel Body */}
      {isOpen && createPortal(modalContent, document.body)}
    </>
  )
}
