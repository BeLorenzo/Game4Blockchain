import { Agent } from "../Agent";
import { IBaseGameAdapter  } from "./IBaseGameAdapter";

/**
 * Extended adapter for multi-round games with internal state management
 * (PirateGame, future negotiation games, etc.)
 */
export interface IMultiRoundGameAdapter extends IBaseGameAdapter  {

  //Setup iniziale per impostare stato partenza corretto
  setup(agents: Agent[], sessionId: bigint): Promise<void>

  // Ti dice quanti round totali ci si aspetta 
  getMaxTotalRounds(sessionId: bigint): Promise<number>; 
  
  // Esegue UN singolo round o turno (chiamerà commit, reveal, resolve e claim qunado servono)
  playRound(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<boolean>;
  
  // Finalizza la sessione alla fine dei turni
  finalize(agents: Agent[], sessionId: bigint): Promise<void>;
}
