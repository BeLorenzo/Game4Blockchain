import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useEffect, useState } from 'react'
import { config } from '../config'
import { GAME_PREFIXES } from '../hooks/usePlayerStats' 

export const BlockchainStats = () => {
  const [currentRound, setCurrentRound] = useState<bigint>(0n)
  
  // Leggiamo la rete direttamente dalla config, senza bisogno di metterla nello stato (è statica)
  const isTestNet = config.algodConfig.network === 'testnet'
  const networkName = isTestNet ? 'TestNet' : 'LocalNet'

  useEffect(() => {
    // 1. Istanziamo il client UNA volta sola
    const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
    
    const fetchStats = async () => {
      try {
        const status = await algorand.client.algod.status().do()
        // Aggiorniamo solo se il round è cambiato per evitare re-render inutili
        setCurrentRound((prev) => {
          const newRound = BigInt(status['lastRound']) // SDK a volte usa kebab-case o camelCase, controlla
          return newRound > prev ? newRound : prev
        })
      } catch (e) {
        console.error('Errore fetch stats:', e)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 4000) // 2s è troppo aggressivo per TestNet (blocco ogni 3.3s), facciamo 4s
    
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {/* Current Round */}
      <div className="bg-base-100 p-4 rounded-2xl shadow-sm border border-white/5 flex flex-col items-center">
        <span className="text-[10px] font-bold uppercase opacity-40 tracking-widest">Current Round</span>
        <span className="text-2xl font-mono font-black text-primary">
            {currentRound > 0n ? currentRound.toString() : '...'}
        </span>
      </div>

      {/* Available Games */}
      <div className="bg-base-100 p-4 rounded-2xl shadow-sm border border-white/5 flex flex-col items-center">
        <span className="text-[10px] font-bold uppercase opacity-40 tracking-widest">Available Games</span>
        <span className="text-2xl font-bold">{GAME_PREFIXES.length}</span>
      </div>

      {/* Active Network */}
      <div className="bg-base-100 p-4 rounded-2xl shadow-sm border border-white/5 flex flex-col items-center">
        <span className="text-[10px] font-bold uppercase opacity-40 tracking-widest">Active Net</span>
        <span className={`text-2xl font-bold uppercase mt-2 ${isTestNet ? 'text-warning' : 'text-success'}`}>
            {networkName}
        </span>
      </div>
    </div>
  )
}