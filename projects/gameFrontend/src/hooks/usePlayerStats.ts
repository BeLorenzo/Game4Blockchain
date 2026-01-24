/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'

/**
 * Game Registry - Quando aggiungi un nuovo gioco, aggiungilo qui
 */
export const GAME_PREFIXES = ['guess_', 'rps_', 'weekly_'] as const

/**
 * Hook per calcolare il profitto totale del player
 * Scansiona il localStorage e somma tutti i claim results
 */
export const usePlayerStats = (address: string | undefined) => {
  const [totalProfit, setTotalProfit] = useState(0)

  const calculateStats = useCallback(() => {
    if (!address) {
      setTotalProfit(0)
      return
    }

    let profit = 0

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      // Verifica che sia una chiave di gioco dell'address connesso
      const isGameKey = GAME_PREFIXES.some(prefix => key.startsWith(prefix))
      if (!isGameKey || !key.includes(address)) continue

      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}')
        if (data.claimResult?.amount !== undefined) {
          profit += data.claimResult.amount
        }
      } catch (e) {
        console.warn('Error parsing game data:', key, e)
      }
    }

    setTotalProfit(profit)
  }, [address])

  useEffect(() => {
    calculateStats()

    const handleUpdate = () => calculateStats()
    window.addEventListener('game-storage-update', handleUpdate)
    window.addEventListener('storage', handleUpdate)

    return () => {
      window.removeEventListener('game-storage-update', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [calculateStats])

  return { totalProfit }
}
