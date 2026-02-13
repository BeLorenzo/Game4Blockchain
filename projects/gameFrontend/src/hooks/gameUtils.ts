/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GAME UTILITIES
 *
 * Minimal shared utilities used across all blockchain games.
 * 
 * This module provides core functionality for:
 * - Cryptographic commitments (commit/reveal pattern)
 * - Game phase calculations
 * - Timeout handling for unrevealed moves
 * - Storage update notifications
 */

import algosdk from 'algosdk'

/**
 * Computes SHA-256 hash of the input data.
 * 
 * Used in commit/reveal patterns to create hash commitments that hide
 * the original value until the reveal phase.
 * @example
 * const hash = await sha256(new Uint8Array([1, 2, 3]))
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer)
  return new Uint8Array(hashBuffer)
}

/**
 * Creates a commitment hash for a game value using a random salt.
 * 
 * This function implements the commit/reveal pattern used in many blockchain games:
 * 1. Generate random salt
 * 2. Concatenate value bytes with salt
 * 3. Hash the combined data
 * 4. Store salt locally for later reveal
 * 
 * @example
 * // Commit to guess 42
 * const { commitHash, salt } = await createCommit(42)
 * // Send commitHash to contract, store salt locally
 */
export async function createCommit(value: number, saltLength = 32) {
  // Generate cryptographically secure random salt
  const salt = new Uint8Array(saltLength)
  crypto.getRandomValues(salt)

  // Encode value as 8-byte unsigned integer
  const valueBytes = algosdk.encodeUint64(value)
  
  // Concatenate value bytes with salt
  const buffer = new Uint8Array(valueBytes.length + salt.length)
  buffer.set(valueBytes)
  buffer.set(salt, valueBytes.length)

  // Compute SHA-256 hash of the combined data
  const commitHash = await sha256(buffer)

  return { commitHash, salt }
}

/**
 * Determines the current phase of a game session based on round numbers.
 * 
 * Game sessions have three phases with specific round boundaries:
 * - WAITING: Before session starts (currentRound < startAt)
 * - COMMIT: During commit phase (currentRound ≤ endCommitAt)
 * - REVEAL: During reveal phase (endCommitAt < currentRound ≤ endRevealAt)
 * - ENDED: After reveal phase ends (currentRound > endRevealAt)
 * @example
 * const phase = getPhase(1000, 500, 800, 1200) // Returns 'REVEAL'
 */
export function getPhase(
  currentRound: number,
  startAt: number,
  endCommitAt: number,
  endRevealAt: number
): 'WAITING' | 'COMMIT' | 'REVEAL' | 'ENDED' {
  if (currentRound < startAt) return 'WAITING'
  if (currentRound <= endCommitAt) return 'COMMIT'
  if (currentRound <= endRevealAt) return 'REVEAL'
  return 'ENDED'
}

/**
 * Handles timeout claims for players who committed but didn't reveal.
 * 
 * When a player commits to a move but fails to reveal it before the reveal phase ends,
 * they forfeit their participation fee. This function:
 * 1. Checks if timeout conditions are met
 * 2. Creates a timeout claim result if applicable
 * 3. Saves the result to localStorage
 * 4. Notifies listeners of the storage update
 * 
 * @example
 * // Player committed but didn't reveal by endRevealAt
 * const result = handleTimeout('game_key', 10, true, false, null, 1500, 1200)
 * // Returns { amount: -10, timestamp: 123..., isTimeout: true }
 */
export function handleTimeout(
  storageKey: string | null,
  fee: number,
  hasPlayed: boolean,
  hasRevealed: boolean,
  claimResult: any,
  currentRound: number,
  endRevealAt: number
): any {
  // Skip if player didn't participate, already revealed, already claimed, or time not expired
  if (!hasPlayed || hasRevealed || claimResult || currentRound <= endRevealAt) {
    return claimResult
  }

  const timeoutResult = {
    amount: -fee, 
    timestamp: Date.now(),
    isTimeout: true, 
  }

  if (storageKey) {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const data = JSON.parse(stored)
        data.claimResult = timeoutResult
        localStorage.setItem(storageKey, JSON.stringify(data))
        notifyUpdate() 
      }
    } catch (e) {
      console.warn('Failed to save timeout:', e)
    }
  }

  return timeoutResult
}

/**
 * Notifies listeners of updates to game-related localStorage data.
 * 
 * Dispatches a custom 'game-storage-update' event that can be listened to
 * by components that need to react to changes in game state (e.g., profit calculators).
 * 
 * @example
 * // Component can listen for updates:
 * window.addEventListener('game-storage-update', () => {
 *   console.log('Game storage updated, recalculating stats')
 * })
 */
export function notifyUpdate(): void {
  window.dispatchEvent(new Event('game-storage-update'))
}