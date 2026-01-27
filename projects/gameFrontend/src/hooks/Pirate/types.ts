/**
 * LE FASI DEL PIRATE GAME
 * * Differenze chiave rispetto a GuessGame:
 * - Ciclicità: Si può tornare a PROPOSAL se una votazione fallisce (il capitano muore).
 * - EXECUTION: Non è una fase esplicita nel contratto ma un momento di transizione.
 */
export type PirateGamePhase = 
  | 'REGISTRATION'  // Fase 0: Iscrizione aperta
  | 'PROPOSAL'      // Fase 1: Il capitano corrente deve inviare la distribuzione
  | 'VOTE_COMMIT'   // Fase 2: La ciurma invia l'hash del voto
  | 'VOTE_REVEAL'   // Fase 3: La ciurma rivela il voto (Sì/No)
  | 'ENDED'      // Fase 4: Bottino distribuito o tutti morti

/**
 * DATI DEL SINGOLO PIRATA
 * * Lo stato del giocatore è persistente e gerarchico.
 */
export interface PirateInfo {
  /** L'indirizzo wallet del pirata */
  address: string
  
  /** * Fondamentale: Determina l'ordine di successione.
   * 0 = Primo Capitano. Se muore, tocca a 1, ecc.
   */
  seniorityIndex: number
  
  /** Se false, il pirata è stato eliminato e non può più votare/proporre */
  alive: boolean
  
  /** * Flag calcolato frontend-side. 
   * True se questo pirata è quello che deve agire nella fase PROPOSAL.
   */
  isCurrentProposer: boolean
  
  /** Se true, ha già ritirato la sua quota di vincita */
  claimed: boolean
}

/**
 * DATI DELLA PROPOSTA CORRENTE
 * * Esiste solo durante le fasi PROPOSAL/VOTE.
 */
export interface ProposalInfo {
  /** L'indice di seniority del pirata che ha fatto questa proposta */
  proposerIndex: number
  
  /** * La distribuzione dell'oro proposta.
   * L'indice dell'array corrisponde al seniorityIndex del pirata.
   * Esempio: [0, 100, 50] significa:
   * Pirata 0 (Morto/Proposer): 0
   * Pirata 1: 100 ALGO
   * Pirata 2: 50 ALGO
   */
  distribution: number[]
  
  /** Conteggio voti SÌ (Inclusi quelli del capitano se auto-vota) */
  votesFor: number
  
  /** Conteggio voti NO */
  votesAgainst: number
  
  /** Stato finale della proposta (utile per la UI post-round) */
  outcome: 'PENDING' | 'PASSED' | 'REJECTED' | null
}

/**
 * DATI SUL VOTO DEL GIOCATORE CORRENTE (Me)
 * * Serve a gestire lo stato della UI per Commit/Reveal.
 */
export interface MyVoteStatus {
  hasCommitted: boolean
  hasRevealed: boolean
  /** * Il voto decifrato.
   * 1 = SÌ (Aye!)
   * 0 = NO (Die!)
   * undefined se non ancora rivelato o non votato
   */
  voteDirection?: 0 | 1 
}

/**
 * SESSIONE DI GIOCO COMPLETA
 * * Estende concettualmente la sessione base, ma con logiche specifiche per i Pirati.
 */
export interface PirateGameSession {
  [x: string]: unknown
  // --- Identificativi Base ---
  id: number
  phase: PirateGamePhase
  fee: number
  totalPot: number // Il bottino totale in ALGO
  
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
  
  // --- Dati "My" (Specifici dell'utente connesso) ---
  /** Info sul mio pirata se sono iscritto */
  myPirateInfo: PirateInfo | null
  
  /** Stato del mio voto nel round corrente */
  myVote: MyVoteStatus | null

  // --- Action Flags (Boolean per la UI) ---
  /** Posso iscrivermi? (Phase === REGISTRATION && !myPirateInfo) */
  canRegister: boolean
  
  /** Tocca a me proporre? (Phase === PROPOSAL && isCurrentProposer) */
  canPropose: boolean
  
  /** Posso votare? (Phase === VOTE_COMMIT && alive && !isProposer && !hasCommitted) */
  canVote: boolean
  
  /** Posso rivelare? (Phase === VOTE_REVEAL && hasCommitted && !hasRevealed) */
  canReveal: boolean
  
  /** * Posso forzare l'esecuzione? 
   * True se il tempo è scaduto per Proposal o Reveal, o se tutti hanno rivelato.
   */
  canExecute: boolean
  
  /** Posso ritirare? (Game FINISHED && alive && !claimed) */
  canClaim: boolean

  gameRound: number
  // --- Timing (Blocks/Rounds) ---
  /** * Gestione temporale. 
   * Nota: Nel PirateGame le scadenze si resettano ad ogni cambio di stato (Proposal -> Vote -> Next Round).
   * Questi valori devono riferirsi alla scadenza della FASE ATTUALE.
   */
  rounds: {
    current: number      // Blocco attuale della chain
    start: number        // Inizio della fase corrente
    endPhase: number     // Scadenza della fase corrente (Timeout)
  }
}