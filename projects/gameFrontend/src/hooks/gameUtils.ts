/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GAME UTILITIES
 *
 * Utilities minimali condivise tra tutti i giochi.
 */

import algosdk from 'algosdk'

// ============================================================================
// CRYPTO UTILITIES
// ============================================================================

/**
 * SHA-256 hash per commit/reveal pattern
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer)
  return new Uint8Array(hashBuffer)
}

/**
 * Crea commit hash per un valore (usato in join)
 */
export async function createCommit(value: number, saltLength = 32) {
  const salt = new Uint8Array(saltLength)
  crypto.getRandomValues(salt)

  const valueBytes = algosdk.encodeUint64(value)
  const buffer = new Uint8Array(valueBytes.length + salt.length)
  buffer.set(valueBytes)
  buffer.set(salt, valueBytes.length)

  const commitHash = await sha256(buffer)

  return { commitHash, salt }
}

// ============================================================================
// PHASE CALCULATION
// ============================================================================

/**
 * Calcola la fase corrente di una sessione
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

// ============================================================================
// TIMEOUT HANDLING
// ============================================================================

/**
 * Gestisce il timeout per chi ha committato ma non ha fatto reveal
 * Ritorna il claimResult aggiornato (con timeout) o quello esistente
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
  // Se non ha giocato, ha già rivelato, ha già un claim, o il tempo non è scaduto
  if (!hasPlayed || hasRevealed || claimResult || currentRound <= endRevealAt) {
    return claimResult
  }

  // Crea claim result di timeout
  const timeoutResult = {
    amount: -fee,
    timestamp: Date.now(),
    isTimeout: true,
  }

  // Salva nel localStorage
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

// ============================================================================
// STORAGE NOTIFICATIONS
// ============================================================================

/**
 * Notifica aggiornamento storage (per usePlayerStats)
 */
export function notifyUpdate(): void {
  window.dispatchEvent(new Event('game-storage-update'))
}
