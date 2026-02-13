/**
 * PIRATE GAME TYPE DEFINITIONS
 * 
 * This module defines the core TypeScript interfaces and types for the Pirate Game,
 * a multi-round bargaining and voting game implemented on the Algorand blockchain.
 * 
 * The game models a classic game theory problem where pirates must agree on
 * treasure distribution through sequential proposals and voting.
 */

/**
 * THE PHASES OF THE PIRATE GAME
 * 
 * The game progresses through these sequential phases:
 */
export type PirateGamePhase = 
  | 'REGISTRATION'  // Phase 0: Open registration
  | 'PROPOSAL'      // Phase 1: Current captain must send distribution
  | 'VOTE_COMMIT'   // Phase 2: Crew submits vote hash
  | 'VOTE_REVEAL'   // Phase 3: Crew reveals vote (Yes/No)
  | 'ENDED'         // Phase 4: Awaiting resolution → either treasure distributed or restart round

/**
 * Represents the result of a pirate's claim (win/loss).
 */
export interface PirateClaimResult {
  amount: number
  isTimeout: boolean
  timestamp: number
  isWin: boolean
}

/**
 * Data for a single pirate
 */
export interface PirateInfo {
  /** The pirate's wallet address */
  address: string
  
  /** 
   * Determines succession order.
   * 0 = First Captain. If dies, responsibility goes to 1, etc.
   */
  seniorityIndex: number
  
  /** If false, the pirate was eliminated and can no longer vote/propose */
  alive: boolean
  
  /** 
   * True if this pirate is the one who must act in the PROPOSAL phase.
   * Only the oldest alive pirate (lowest seniorityIndex) is the current proposer.
   */
  isCurrentProposer: boolean
  
  /** If true, has already withdrawn their winning share */
  claimed: boolean
}

/**
 * Data for the current proposal
 */
export interface ProposalInfo {
  /** Seniority index of the pirate who made this proposal */
  proposerIndex: number
  
  /** 
   * The proposed gold distribution in microAlgos.
   * Array index corresponds to the pirate's seniorityIndex.
   * Example: [0, 100, 50] means:
   *   Pirate 0 (Dead): 0 microAlgos
   *   Pirate 1: 100 microAlgos
   *   Pirate 2: 50 microAlgos
   */
  distribution: number[]
  
  /** Count of YES votes */
  votesFor: number
  
  /** Count of NO votes */
  votesAgainst: number
  
  /** Final state of the proposal */
  outcome: 'PENDING' | 'PASSED' | 'REJECTED' | null
}

/**
 * Voting status for the current player (Me)
 * 
 * Used to manage UI state for Commit/Reveal actions.
 */
export interface MyVoteStatus {
  hasCommitted: boolean
  hasRevealed: boolean
  voteDirection?: 0 | 1 
}

/**
 * Complete game session data
 * 
 * Contains all state information for a single Pirate Game session.
 */
export interface PirateGameSession {
  [x: string]: unknown  
  id: number
  phase: PirateGamePhase
  fee: number
  totalPot: number 
  
  /** Complete list of all registered pirates, ordered by seniority */
  pirates: PirateInfo[]
  
  /** Number of pirates still alive (useful for majority calculation) */
  alivePiratesCount: number
  
  /** Seniority index of the captain who "commands" in this round */
  currentProposerIndex: number

  /** Details of the active proposal (if exists) */
  currentProposal: ProposalInfo | null
  
  /** Current player's pirate data (null if not registered) */
  myPirateInfo: PirateInfo | null
  
  /** Current player's voting status in the current round */
  myVote: MyVoteStatus | null

  /** Result of claim (if game ended for this player) */
  claimResult: PirateClaimResult | null

  /** Can the player register? (Phase === REGISTRATION && before start time) */
  canRegister: boolean
  
  /** Is it my turn to propose? (Phase === PROPOSAL && isCurrentProposer) */
  canPropose: boolean
  
  /** Can I vote? (Phase === VOTE_COMMIT && alive && !isProposer && !hasCommitted) */
  canVote: boolean
  
  /** Can I reveal? (Phase === VOTE_REVEAL && hasCommitted && !hasRevealed) */
  canReveal: boolean
  
  /** Can I force execution? 
   * True if time expired for Reveal phase or other timeout conditions.
   */
  canExecute: boolean
  
  /** Can I withdraw winnings? (Phase === ENDED && not claimed) */
  canClaim: boolean

  /** Current game round number (increments after each captain elimination) */
  gameRound: number
  
  /** Timing management for phase transitions and timeouts */
  rounds: {
    current: number      // Current blockchain round
    start: number        // Start round of current phase
    endPhase: number     // Expiration round of current phase (for timeout)
  }
}