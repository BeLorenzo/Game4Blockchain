/* eslint-disable @typescript-eslint/no-unused-vars */

import { Agent } from '../Agent'

export type GameLogger = (message: string, type?: 'thought' | 'action' | 'system' | 'game_event') => void;

/**
 * Base Game Adapter Interface.
 * Defines the standard lifecycle methods that all game implementations must support
 * to be compatible with the Simulation Framework.
 */
export interface IBaseGameAdapter {
  /** Game identifier */
  readonly name: string

  setLogger(logger: GameLogger): void;

  deploy(deployer: Agent): Promise<void>;

  /** Start a new game session */
  startSession(dealer: Agent): Promise<bigint>

  /** Phase 1: Commit.
   * Agents calculate their move, hash it with a salt, and submit the hash to the chain.
   */
  commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>

  /** Phase 2: Reveal.
   * Agents submit their original move and secret salt to verify their commitment.
   */
  reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>

  /** Phase 3: Resolution.
   * Triggers the smart contract to calculate the winner/outcome based on revealed moves.
   */
  resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void>

  /** * Phase 4: Claim.
   * Agents interact with the contract to withdraw their winnings or refunds.
   */
  claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>
}
