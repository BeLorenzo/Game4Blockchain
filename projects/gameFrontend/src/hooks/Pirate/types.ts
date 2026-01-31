/**
 * LE FASI DEL PIRATE GAME
 */
export type PirateGamePhase = 
  | 'REGISTRATION'  // Fase 0: Iscrizione aperta
  | 'PROPOSAL'      // Fase 1: Il capitano corrente deve inviare la distribuzione
  | 'VOTE_COMMIT'   // Fase 2: La ciurma invia l'hash del voto
  | 'VOTE_REVEAL'   // Fase 3: La ciurma rivela il voto (Sì/No)
  | 'ENDED'      // Fase 4: Attesa di risoluzione -> o Bottino distribuito o rinizio round

export interface PirateClaimResult {
  amount: number
  isTimeout: boolean
  timestamp: number
  isWin: boolean
}

/**
 * DATI DEL SINGOLO PIRATA
 */
export interface PirateInfo {
  /** L'indirizzo wallet del pirata */
  address: string
  
  /** Determina l'ordine di successione.
   * 0 = Primo Capitano. Se muore, tocca a 1, ecc.
   */
  seniorityIndex: number
  
  /** Se false, il pirata è stato eliminato e non può più votare/proporre */
  alive: boolean
  
  /** 
   * True se questo pirata è quello che deve agire nella fase PROPOSAL.
   */
  isCurrentProposer: boolean
  
  /** Se true, ha già ritirato la sua quota di vincita */
  claimed: boolean
}

/**
 * DATI DELLA PROPOSTA CORRENTE
 */
export interface ProposalInfo {
  /** L'indice di seniority del pirata che ha fatto questa proposta */
  proposerIndex: number
  
  /** * La distribuzione dell'oro proposta.
   * L'indice dell'array corrisponde al seniorityIndex del pirata.
   * Esempio: [0, 100, 50] significa:
   * Pirata 0 (Morto): 0
   * Pirata 1: 100 ALGO
   * Pirata 2: 50 ALGO
   */
  distribution: number[]
  
  /** Conteggio voti SÌ */
  votesFor: number
  
  /** Conteggio voti NO */
  votesAgainst: number
  
  /** Stato finale della proposta */
  outcome: 'PENDING' | 'PASSED' | 'REJECTED' | null
}

/**
 * DATI SUL VOTO DEL GIOCATORE CORRENTE (Me)
 * * Serve a gestire lo stato della UI per Commit/Reveal.
 */
export interface MyVoteStatus {
  hasCommitted: boolean
  hasRevealed: boolean
  voteDirection?: 0 | 1 
}

/**
 * SESSIONE DI GIOCO COMPLETA
 */
export interface PirateGameSession {
  [x: string]: unknown
  id: number
  phase: PirateGamePhase
  fee: number
  totalPot: number 
  
  // --- Stato dei Partecipanti ---
  /** Lista completa di tutti i pirati iscritti, ordinata per seniority */
  pirates: PirateInfo[]
  
  /** Numero di pirati ancora vivi (utile per calcolare la maggioranza) */
  alivePiratesCount: number
  
  /** L'indice di seniority del capitano che "comanda" in questo round */
  currentProposerIndex: number

  // --- Stato del Round Corrente ---
  /** Dettagli sulla proposta attiva (se esiste) */
  currentProposal: ProposalInfo | null
  
  myPirateInfo: PirateInfo | null
  
  /** Stato del mio voto nel round corrente */
  myVote: MyVoteStatus | null


  claimResult: PirateClaimResult | null

  // --- Action Flags (Boolean per la UI) ---
  canRegister: boolean
  
  /** Tocca a me proporre? (Phase === PROPOSAL && isCurrentProposer) */
  canPropose: boolean
  
  /** Posso votare? (Phase === VOTE_COMMIT && alive && !isProposer && !hasCommitted) */
  canVote: boolean
  
  /** Posso rivelare? (Phase === VOTE_REVEAL && hasCommitted && !hasRevealed) */
  canReveal: boolean
  
  /** * Posso forzare l'esecuzione? 
   * True se il tempo è scaduto per Reveal.
   */
  canExecute: boolean
  
  /** Posso ritirare? */
  canClaim: boolean

  gameRound: number
  // --- Timing (Blocks/Rounds) ---
  /** * Gestione temporale. 
   */
  rounds: {
    current: number      // Blocco attuale della chain
    start: number        // Inizio della fase corrente
    endPhase: number     // Scadenza della fase corrente (Timeout)
  }
}