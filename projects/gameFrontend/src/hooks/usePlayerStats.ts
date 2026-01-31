/* eslint-disable @typescript-eslint/no-explicit-any */
import { useWallet } from '@txnlab/use-wallet-react'
import { useState, useEffect, useCallback } from 'react'

/**
 * Game Registry - Quando aggiungi un nuovo gioco, aggiungilo qui
 */
export const GAME_PREFIXES = ['guess_', 'rps_', 'weekly_', 'stag_', 'pirate_'] as const

/**
 * Hook per calcolare il profitto totale del player
 * Scansiona il localStorage e somma tutti i claim results
 */
export const usePlayerStats = () => {
  const { activeAddress } = useWallet()
  const [totalProfit, setTotalProfit] = useState(0)

  const calculateStats = useCallback(() => {
    if (!activeAddress) {
      setTotalProfit(0)
      return
    }

    let profit = 0

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      // Verifica che sia una chiave di gioco dell'address connesso
      const isGameKey = GAME_PREFIXES.some(prefix => key.startsWith(prefix))
      if (!isGameKey || !key.includes(activeAddress)) continue

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
  }, [activeAddress])

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

/**
 * Hook per calcolare il P/L di un SINGOLO gioco specifico.
 */
export const useGameSpecificProfit = (gamePrefix: string, appId: number | bigint) => {
  const { activeAddress } = useWallet()
  const [profit, setProfit] = useState(0)

  useEffect(() => {
    const calculate = () => {
      if (!activeAddress || !appId) {
        setProfit(0)
        return
      }

      let total = 0
      const searchPrefix = `${gamePrefix}_${appId}_${activeAddress}`

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        
        if (key && key.startsWith(searchPrefix)) {
          try {
            const item = localStorage.getItem(key)
            if (item) {
              const data = JSON.parse(item)
              if (data.claimResult?.amount !== undefined) {
                total += Number(data.claimResult.amount)
              }
            }
          } catch (e) {
            console.warn(`Error parsing key ${key}`, e)
          }
        }
      }
      setProfit(total)
    }
    calculate()

    window.addEventListener('game-storage-update', calculate)
    return () => window.removeEventListener('game-storage-update', calculate)
  }, [activeAddress, appId, gamePrefix])

  return {profit}
}