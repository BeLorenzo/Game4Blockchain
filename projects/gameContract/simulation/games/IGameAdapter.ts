import { Agent } from '../Agent'

/**
 * Game adapters are responsible for:
 * 1. Contract deployment and session management
 * 2. Preparing complete context/prompts for agents
 * 3. Handling commit/reveal/claim phases
 */
export interface IGameAdapter {
  /** Game identifier */
  readonly name: string

  /** Deploy smart contract */
  deploy(admin: Agent): Promise<bigint>

  /** Start a new game session */
  startSession(dealer: Agent): Promise<bigint>

  /** 
   * Commit phase: Each agent makes a hidden choice 
   * Game adapter prepares the full prompt/context for each agent
   */
  play_Commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>

  /** Reveal phase: Agents reveal their choices */
  play_Reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>

  /** Resolution phase (if needed by game) */
  resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void>

  /** Claim phase: Distribute rewards and finalize */
  play_Claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>
}