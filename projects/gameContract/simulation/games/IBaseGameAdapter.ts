/* eslint-disable @typescript-eslint/no-unused-vars */

import { Account, Address } from 'algosdk';
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

/**
   * Injects a logger function provided by the simulation framework.
   * 
   * The adapter must use this logger for:
   * - game events (on-chain or off-chain)
   * - agent actions and decisions
   * - system-level messages useful for debugging or visualization
   * 
   * The logger is optional in usage but must be supported.
   */
  setLogger(logger: GameLogger): void;

  /**
   * Deploys all on-chain resources required by the game.
   * 
   * This typically includes:
   * - smart contract deployment
   * - application initialization
   * - creation of assets or global state
   * 
   * The `suffix` parameter allows multiple independent deployments
   * of the same game (e.g. simulation and "human gaming").
   */
  deploy(deployer: Account, suffix: string): Promise<void>;

  /**
   * Registers a state updater callback used to push game state changes
   * to the simulation framework.
   * 
   * The adapter should call this function whenever relevant state
   * changes occur (e.g. round transitions, revealed moves, payouts).
   * 
   * The structure of `updates` is game-specific and not enforced
   * by the framework.
   */
  setStateUpdater(updater: (updates: any) => void): void;
  
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
