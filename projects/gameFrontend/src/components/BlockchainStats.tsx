import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useEffect, useState } from 'react'
import { config } from '../config'

export const BlockchainStats = () => {
  const [stats, setStats] = useState({
    round: 0n,
    network: 'LocalNet',
  })

  const fetchStats = async () => {
    try {
      const algorand = AlgorandClient.fromConfig({ algodConfig: config.algodConfig })
      const status = await algorand.client.algod.status().do()
      setStats((prev) => ({
        ...prev,
        round: status['lastRound'],
      }))
    } catch (e) {
      console.error('Errore fetch stats:', e)
    }
  }

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 2000) // Aggiorna ogni 2 secondi
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div className="bg-base-100 p-4 rounded-2xl shadow-sm border border-white/5 flex flex-col items-center">
        <span className="text-[10px] font-bold uppercase opacity-40 tracking-widest">Round Corrente</span>
        <span className="text-2xl font-mono font-black text-primary">{stats.round.toString()}</span>
      </div>

      <div className="bg-base-100 p-4 rounded-2xl shadow-sm border border-white/5 flex flex-col items-center">
        <span className="text-[10px] font-bold uppercase opacity-40 tracking-widest">Giochi Disponibili</span>
        <span className="text-2xl font-bold">3</span>
      </div>

      <div className="bg-base-100 p-4 rounded-2xl shadow-sm border border-white/5 flex flex-col items-center">
        <span className="text-[10px] font-bold uppercase opacity-40 tracking-widest">Rete Attiva</span>
        <span className="text-2xl font-bold text-success uppercase text-sm mt-2">{stats.network}</span>
      </div>
    </div>
  )
}
