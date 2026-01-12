import { Agent } from "../Agent";
import { IBaseGameAdapter  } from "./IBaseGameAdapter";

/**
 * Extended adapter for multi-round, stateful games.
 * Used for games where a single blockchain session involves multiple iterations 
 * of player interaction (e.g., Pirate Game eliminations, negotiation loops).
 */
export interface IMultiRoundGameAdapter extends IBaseGameAdapter  {

/**
   * Performs initial setup logic required before the first round begins.
   * Useful for registering players, setting up local state, or funding specific accounts.
   */
  setup(agents: Agent[], sessionId: bigint): Promise<void>

  /**
   * Retrieves the maximum expected number of rounds for this session.
   * Used by the simulation loop to bound the execution.
   */ 
  getMaxTotalRounds(sessionId: bigint): Promise<number>; 
  
  /**
   * Executes a single internal round of the game.
   * This method encapsulates the Commit -> Reveal -> Resolve logic for that specific turn.
   */
  playRound(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<boolean>;
  
  /**
   * Finalizes the game session after all rounds are completed or the game ends early.
   * Handles final payouts, stats logging, and state cleanup.
   */
  finalize(agents: Agent[], sessionId: bigint): Promise<void>;
}
