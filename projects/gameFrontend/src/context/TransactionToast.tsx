import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { config } from '../config'

// Tipi di transazione supportati per icone/colori diversi
export type TransactionType = 'PROPOSE' | 'CREATE' | 'DEPLOY' | 'JOIN' | 'COMMIT' | 'REVEAL' | 'CLAIM' | 'EXECUTE' | 'GENERIC'

interface ToastData {
  id: string // ID interno del toast
  txId: string // ID della transazione Algorand
  agentName: string // Indirizzo wallet (Umano) o Nome Agente (Sim)
  type: TransactionType
  network: 'localnet' | 'testnet'
}

interface TransactionToastContextType {
  showToast: (data: Omit<ToastData, 'id' | 'network'>) => void
}

const TransactionToastContext = createContext<TransactionToastContextType | null>(null)

export const useTransactionToast = () => {
  const context = useContext(TransactionToastContext)
  if (!context) throw new Error('useTransactionToast must be used within a TransactionToastProvider')
  return context
}

export const TransactionToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastData[]>([])
  
  // Rileva la rete dalla config globale
  const currentNetwork = config.algodConfig.network === 'testnet' ? 'testnet' : 'localnet'

  const showToast = useCallback((data: Omit<ToastData, 'id' | 'network'>) => {
    const newToast: ToastData = {
      ...data,
      id: Math.random().toString(36).substr(2, 9),
      network: currentNetwork
    }
    
    setToasts((prev) => [...prev, newToast])

    // Auto-rimozione dopo 5 secondi
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== newToast.id))
    }, 6000) // Un po' più lungo per dare tempo di cliccare
  }, [currentNetwork])

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <TransactionToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* CONTAINER DEI TOAST (Angolo in basso a destra) */}
      <div className="toast toast-end toast-bottom z-[99999] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div 
            key={toast.id} 
            className="alert bg-gray-900 border border-primary/30 shadow-[0_0_15px_rgba(0,0,0,0.5)] text-left p-3 min-w-[300px] cursor-pointer hover:bg-gray-800 transition-all transform hover:scale-105"
            onClick={() => {
                // APRE LORA AL CLICK
                const url = `https://lora.algokit.io/${toast.network}/transaction/${toast.txId}`
                window.open(url, '_blank')
            }}
          >
            <div className="flex items-start gap-3">
              {/* Icona in base al tipo */}
              <div className={`mt-1 p-2 rounded-full ${getTypeColor(toast.type)}`}>
                 {getTypeIcon(toast.type)}
              </div>
              
              <div className="flex-1 overflow-hidden">
                <div className="flex justify-between items-center mb-1">
                   <h3 className="font-bold text-xs uppercase tracking-wider opacity-70">{toast.type}</h3>
                   <span className="text-[10px] bg-white/10 px-1 rounded">{toast.network}</span>
                </div>
                
                <div className="text-sm font-bold text-white truncate w-full">
                  {toast.agentName}
                </div>
                
                <div className="text-[10px] font-mono text-gray-400 truncate mt-1">
                  TxID: <span className="text-primary underline">{toast.txId.substring(0, 8)}...{toast.txId.substring(48)}</span>
                </div>
                
                <div className="text-[9px] text-gray-500 mt-1 italic">
                   Click to view on Lora
                </div>
              </div>
              
              <button 
                onClick={(e) => { e.stopPropagation(); removeToast(toast.id) }} 
                className="btn btn-xs btn-circle btn-ghost"
              >✕</button>
            </div>
          </div>
        ))}
      </div>
    </TransactionToastContext.Provider>
  )
}

// Helpers per stile
const getTypeColor = (type: TransactionType) => {
    switch(type) {
        case 'PROPOSE': return 'bg-gray-500/20 text-gray-400'
        case 'DEPLOY': return 'bg-purple-500/20 text-purple-400'
        case 'CREATE': return 'bg-pink-500/20 text-pink-400'
        case 'COMMIT': return 'bg-blue-500/20 text-blue-400'
        case 'REVEAL': return 'bg-yellow-500/20 text-yellow-400'
        case 'EXECUTE': return 'bg-red-500/20 text-red-400'
        case 'CLAIM': return 'bg-green-500/20 text-green-400'
        default: return 'bg-gray-500/20 text-gray-400'
    }
}

const getTypeIcon = (type: TransactionType) => {
    switch(type) {
        case 'PROPOSE': return '⚖️'
        case 'DEPLOY': return '🚀'
        case 'CREATE': return '📝'
        case 'COMMIT': return '🔒'
        case 'REVEAL': return '🔓'
        case 'EXECUTE': return '⚙️'
        case 'CLAIM': return '💰'
        default: return '📝'
    }
}