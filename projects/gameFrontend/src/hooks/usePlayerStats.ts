/* eslint-disable no-console */
import { useState, useEffect } from 'react'
import { config } from '../config'

export const usePlayerStats = (activeAddress: string | null) => {
  const [totalProfit, setTotalProfit] = useState(0)

  const calculateStats = () => {
    if (!activeAddress) {
      setTotalProfit(0)
      return
    }

    let sum = 0
    const prefix = `guess_${config.games.guessGame.appId}_${activeAddress}_`

    // Itera su tutte le chiavi del local storage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) {
        try {
          const item = localStorage.getItem(key)
          if (item) {
            const data = JSON.parse(item)
            if (data.claimResult && typeof data.claimResult.amount === 'number') {
              sum += data.claimResult.amount
            }
          }
        } catch (e) {
          console.warn('Error parsing game data', e)
        }
      }
    }
    setTotalProfit(sum)
  }

  useEffect(() => {
    calculateStats()

    // Ascolta evento custom (lanciato da useGuessGame)
    const handleUpdate = () => calculateStats()
    window.addEventListener('game-storage-update', handleUpdate)

    // Ascolta anche storage events (se cambiano da altri tab)
    window.addEventListener('storage', handleUpdate)

    return () => {
      window.removeEventListener('game-storage-update', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [activeAddress])

  return { totalProfit }
}
