/**
 * PIRATE GAME STORAGE UTILITIES
 * 
 * Manages local persistence for:
 * 1. Registration (simple flag)
 * 2. Voting (Salt + Vote for each specific round)
 * 3. Claim (Final result)
 * 
 * Uses localStorage to store game state between browser sessions and
 * across game rounds. Each storage key follows a specific naming convention
 * to avoid collisions and enable efficient retrieval.
 */

/**
 * Represents the complete game data stored for a player in a session.
 */
export interface StoredGameData {
  claimResult: {
    amount: number
    timestamp: number
    isTimeout?: boolean
    isWin?: boolean
  }
}

/**
 * Represents voting data stored for a specific game round.
 */
export interface StoredVoteData {
  vote: 0 | 1
  salt: number[] // Important: stored as number array for JSON serialization
  hasRevealed: boolean
  timestamp: number
}

/**
 * Represents claim data for a completed game.
 */
export interface StoredClaimData {
  amount: number
  timestamp: number
  isWin: boolean
}


/**
 * Generates the base storage key for a player in a session.
 */
const getBaseKey = (appId: number, address: string, sessionId: number): string => {
  return `pirate_${appId}_${address}_${sessionId}`
}

/**
 * Generates the storage key for registration status.
 */
const getRegistrationKey = (appId: number, address: string, sessionId: number): string => {
  return `${getBaseKey(appId, address, sessionId)}_registered`
}

/**
 * Generates the storage key for a vote in a specific round.
 */
const getVoteKey = (appId: number, address: string, sessionId: number, roundNumber: number): string => {
  return `${getBaseKey(appId, address, sessionId)}_round${roundNumber}_vote`
}

/**
 * Generates the storage key for claim data.
 */
const getClaimKey = (appId: number, address: string, sessionId: number): string => {
  return `${getBaseKey(appId, address, sessionId)}_claim`
}


/**
 * PirateStorage - Main storage utility object for Pirate Game.
 * 
 * Provides methods for managing registration, voting, and claim data in localStorage.
 * All methods are designed to be SSR-safe (check for window existence).
 */
export const PirateStorage = {
  
  /** 
   * Saves that the user has registered for a session.
   */
  setRegistered: (appId: number, address: string, sessionId: number) => {
    const key = getRegistrationKey(appId, address, sessionId)
    localStorage.setItem(key, JSON.stringify({ registeredAt: Date.now() }))
  },

  /** 
   * Checks if the user is locally registered for a session.
   */
  isRegistered: (appId: number, address: string, sessionId: number): boolean => {
    const key = getRegistrationKey(appId, address, sessionId)
    return !!localStorage.getItem(key)
  },

  /** 
   * Saves the secret vote data (COMMIT PHASE).
   * 
   * Important: roundNumber must be the current proposal round.
   */
  saveVoteCommit: (
    appId: number, 
    address: string, 
    sessionId: number, 
    roundNumber: number, 
    vote: 0 | 1, 
    salt: Uint8Array | number[]
  ) => {
    if (typeof window === 'undefined') return
    
    const saltArray = Array.from(salt)
    
    const data: StoredVoteData = {
      vote,
      salt: saltArray,
      hasRevealed: false,
      timestamp: Date.now()
    }
    
    const key = getVoteKey(appId, address, sessionId, roundNumber)
    localStorage.setItem(key, JSON.stringify(data))
  },

  /**
   * Updates vote status to "Revealed" (REVEAL PHASE).
   * Call after successful revealVote transaction.
   */
  markVoteRevealed: (
    appId: number, 
    address: string, 
    sessionId: number, 
    roundNumber: number
  ) => {
    if (typeof window === 'undefined') return
    
    const key = getVoteKey(appId, address, sessionId, roundNumber)
    const existing = localStorage.getItem(key)
    
    if (existing) {
      const data: StoredVoteData = JSON.parse(existing)
      data.hasRevealed = true
      localStorage.setItem(key, JSON.stringify(data))
    }
  },

  /**
   * Retrieves vote data (needed for Reveal transaction).
   * Returns null if no data found for that specific round.
   */
  getVoteData: (
    appId: number, 
    address: string, 
    sessionId: number, 
    roundNumber: number
  ): StoredVoteData | null => {
    if (typeof window === 'undefined') return null
    
    const key = getVoteKey(appId, address, sessionId, roundNumber)
    const item = localStorage.getItem(key)
    
    if (!item) return null
    try {
      return JSON.parse(item) as StoredVoteData
    } catch {
      return null
    }
  },

  /** 
   * Saves the final claim result.
   */
  saveClaim: (
    appId: number, 
    address: string, 
    sessionId: number, 
    amount: number,
    isTimeout: boolean = false
  ) => {
    if (typeof window === 'undefined') return
    
    const data: StoredGameData = {
      claimResult: {
        amount,
        timestamp: Date.now(),
        isTimeout,
        isWin: amount > 0
      }
    }
    
    const key = getClaimKey(appId, address, sessionId)
    localStorage.setItem(key, JSON.stringify(data))

    window.dispatchEvent(new Event('game-storage-update'))
  },

  /** 
   * Retrieves claim information for a session.
   */
  getClaim: (appId: number, address: string, sessionId: number): StoredGameData['claimResult'] | null => {
    if (typeof window === 'undefined') return null
    
    const key = getClaimKey(appId, address, sessionId)
    const item = localStorage.getItem(key)
    
    if (!item) return null
    try {
      const parsed = JSON.parse(item)
      return parsed.claimResult || null
    } catch {
      return null
    }
  },
  
  /**
   * Checks if a claim result exists for a session.
   */
  hasResult: (appId: number, address: string, sessionId: number): boolean => {
      const key = getClaimKey(appId, address, sessionId)
      return !!localStorage.getItem(key)
  }
}