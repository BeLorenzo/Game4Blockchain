/**
 * PIRATE GAME STORAGE UTILITIES
 * Gestisce la persistenza locale per:
 * 1. Registrazione (flag semplice)
 * 2. Voto (Salt + Voto per ogni round specifico)
 * 3. Claim (Risultato finale)
 */

// --- Tipi di Dati Memorizzati ---

export interface StoredVoteData {
  vote: 0 | 1
  salt: number[] // Importante: salviamo come array di numeri per serializzazione JSON
  hasRevealed: boolean
  timestamp: number
}

export interface StoredClaimData {
  amount: number
  timestamp: number
  isWin: boolean // Utile per UI (se amount > 0 non basta in caso di pareggio/loss)
}

// --- Generazione Chiavi ---

const getBaseKey = (appId: number, address: string, sessionId: number): string => {
  return `pirate_${appId}_${address}_${sessionId}`
}

/**
 * Genera la chiave per lo stato di registrazione
 * Schema: pirate_${appId}_${address}_${sessionId}_registered
 */
const getRegistrationKey = (appId: number, address: string, sessionId: number): string => {
  return `${getBaseKey(appId, address, sessionId)}_registered`
}

/**
 * Genera la chiave per il voto di un round specifico
 * Schema: pirate_${appId}_${address}_${sessionId}_round${roundNumber}_vote
 */
const getVoteKey = (appId: number, address: string, sessionId: number, roundNumber: number): string => {
  return `${getBaseKey(appId, address, sessionId)}_round${roundNumber}_vote`
}

/**
 * Genera la chiave per il claim
 * Schema: pirate_${appId}_${address}_${sessionId}_claim
 */
const getClaimKey = (appId: number, address: string, sessionId: number): string => {
  return `${getBaseKey(appId, address, sessionId)}_claim`
}

// --- Funzioni Exported ---

export const PirateStorage = {
  
  // 1. GESTIONE REGISTRAZIONE
  // ------------------------------------------------------------------
  
  /** Salva il fatto che l'utente si è registrato alla sessione */
  setRegistered: (appId: number, address: string, sessionId: number) => {
    const key = getRegistrationKey(appId, address, sessionId)
    localStorage.setItem(key, JSON.stringify({ registeredAt: Date.now() }))
  },

  /** Controlla se l'utente risulta registrato localmente */
  isRegistered: (appId: number, address: string, sessionId: number): boolean => {
    const key = getRegistrationKey(appId, address, sessionId)
    return !!localStorage.getItem(key)
  },

  // 2. GESTIONE VOTO (Per Round)
  // ------------------------------------------------------------------

  /** * Salva i dati segreti del voto (COMMIT PHASE).
   * Nota: roundNumber deve essere il round corrente della proposta.
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
    
    // Normalizza il salt in array di numeri per evitare problemi con JSON
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
   * Aggiorna lo stato a "Rivelato" (REVEAL PHASE).
   * Da chiamare dopo il successo della transazione revealVote.
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
   * Recupera i dati del voto (necessari per fare il Reveal).
   * Restituisce null se non trova dati per quel round specifico.
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

  // 3. GESTIONE CLAIM
  // ------------------------------------------------------------------

  /** Salva il risultato del claim finale */
  saveClaim: (
    appId: number, 
    address: string, 
    sessionId: number, 
    amount: number
  ) => {
    if (typeof window === 'undefined') return
    
    const data: StoredClaimData = {
      amount,
      isWin: amount > 0,
      timestamp: Date.now()
    }
    
    const key = getClaimKey(appId, address, sessionId)
    localStorage.setItem(key, JSON.stringify(data))
  },

  /** Recupera info sul claim */
  getClaim: (appId: number, address: string, sessionId: number): StoredClaimData | null => {
    if (typeof window === 'undefined') return null
    
    const key = getClaimKey(appId, address, sessionId)
    const item = localStorage.getItem(key)
    
    if (!item) return null
    try {
      return JSON.parse(item) as StoredClaimData
    } catch {
      return null
    }
  },

  // UTILITY GENERICA
  
  /** Pulisce tutti i dati di una sessione specifica (utile per debug o reset) */
  clearSessionData: (appId: number, address: string, sessionId: number) => {
    if (typeof window === 'undefined') return
    
    const baseKey = getBaseKey(appId, address, sessionId)
    // Nota: localStorage non ha un "deleteByPrefix", quindi iteriamo o cancelliamo chiavi note
    // Per sicurezza cancelliamo le note principali:
    localStorage.removeItem(getRegistrationKey(appId, address, sessionId))
    localStorage.removeItem(getClaimKey(appId, address, sessionId))
    
    // Per i round è complicato senza iterare tutto lo storage, 
    // ma in produzione di solito si lasciano scadere o si usa un clear mirato.
    // Qui un approccio semplice iterativo:
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(baseKey)) {
        localStorage.removeItem(key)
      }
    })
  }
}