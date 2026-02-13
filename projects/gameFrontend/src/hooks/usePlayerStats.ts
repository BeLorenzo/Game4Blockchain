/* eslint-disable @typescript-eslint/no-explicit-any */
import { useWallet } from '@txnlab/use-wallet-react'
import { useState, useEffect, useCallback } from 'react'

/**
 * Game Registry - When adding a new game, add its prefix here
 * 
 * These prefixes are used to identify game-specific localStorage keys.
 * Each game should have a unique prefix that matches its storage key pattern.
 */
export const GAME_PREFIXES = ['guess_', 'rps_', 'weekly_', 'stag_', 'pirate_'] as const

/**
 * Custom React hook for calculating total player profit across all games.
 * 
 * Scans localStorage and sums all claim results for the currently connected wallet address.
 * Listens for storage update events to recalculate when game results change.
 */
export const usePlayerStats = () => {
  const { activeAddress } = useWallet()
  const [totalProfit, setTotalProfit] = useState(0)

  /**
   * Calculates total profit by scanning localStorage for game data.
   * 
   * Iterates through all localStorage keys, identifies game-related entries
   * for the currently active wallet address, and sums their claim results.
   */
  const calculateStats = useCallback(() => {
    if (!activeAddress) {
      setTotalProfit(0)
      return
    }

    let profit = 0

    // Scan all localStorage entries
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      // Verify this is a game key for the connected address
      const isGameKey = GAME_PREFIXES.some(prefix => key.startsWith(prefix))
      if (!isGameKey || !key.includes(activeAddress)) continue

      try {
        // Parse game data and accumulate profit from claim results
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

  /**
   * Effect hook for initial calculation and event listener setup.
   * 
   * - Calculates stats on mount and when dependencies change
   * - Listens for custom 'game-storage-update' events (triggered by game actions)
   * - Listens for native 'storage' events (cross-tab synchronization)
   * - Cleans up event listeners on unmount
   */
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
 * Custom React hook for calculating profit/loss for a SPECIFIC game.
 * 
 * Filters localStorage entries by game prefix, app ID, and wallet address
 * to calculate profit for a particular game instance.
 */
export const useGameSpecificProfit = (gamePrefix: string, appId: number | bigint) => {
  const { activeAddress } = useWallet()
  const [profit, setProfit] = useState(0)

  /**
   * Effect hook for calculating and updating game-specific profit.
   * 
   * Recalculates when:
   * - Wallet address changes
   * - App ID changes
   * - Game prefix changes
   * - Custom 'game-storage-update' event is triggered
   */
  useEffect(() => {
    /**
     * Calculates profit for the specific game by scanning localStorage.
     * 
     * Builds a search pattern: `${gamePrefix}_${appId}_${activeAddress}`
     * and sums claim results from all matching keys.
     */
    const calculate = () => {
      if (!activeAddress || !appId) {
        setProfit(0)
        return
      }

      let total = 0
      // Construct search pattern for localStorage keys
      const searchPrefix = `${gamePrefix}_${appId}_${activeAddress}`

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        
        // Check if key matches the game-specific pattern
        if (key && key.startsWith(searchPrefix)) {
          try {
            const item = localStorage.getItem(key)
            if (item) {
              const data = JSON.parse(item)
              // Accumulate profit from claim results
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

    // Recalculate when game storage updates (custom event from gameUtils)
    window.addEventListener('game-storage-update', calculate)
    return () => window.removeEventListener('game-storage-update', calculate)
  }, [activeAddress, appId, gamePrefix])

  return {profit}
}