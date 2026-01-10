/* eslint-disable @typescript-eslint/no-unused-vars */

import { Agent } from "../Agent"

/**
 * Base interface - common methods for ALL games
 */
export interface  IBaseGameAdapter {
  /** Game identifier */
  readonly name: string

  /** Deploy smart contract */
  deploy(admin: Agent): Promise<bigint>

  /** Start a new game session */
  startSession(dealer: Agent): Promise<bigint>

  /** 
   * Commit phase: Each agent makes a hidden choice 
   */
  commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>

  /** Reveal phase: Agents reveal their choices */
  reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>

  /** Resolution phase (if needed by game) */
  resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void>

  /** Claim phase: Distribute rewards and finalize */
  claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>
}
