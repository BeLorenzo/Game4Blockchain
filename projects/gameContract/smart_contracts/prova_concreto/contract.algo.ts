import { gtxn, uint64 } from '@algorandfoundation/algorand-typescript'
import { AbstractGameContract } from '../abstract_contract/contract.algo'
import { GameState } from '../abstract_contract/gameState.algo'

/**
 * Un contratto concreto usato SOLO per i test.
 * Espone i metodi protetti (come createGame) per poterli testare.
 */
export class ProvaConcreteContract extends AbstractGameContract {
  /**
   * Implementazione "vuota" richiesta dall'astratto.
   */
  protected chooseWinner(game: GameState): void {
    return
  }

  public createNewGame(
    maxPlayers: uint64,
    entryFee: uint64,
    mbr: gtxn.PaymentTxn,
    entryPayment: gtxn.PaymentTxn,
    timerCommit: uint64,
    timerReveal: uint64,
  ): uint64 {
    // Chiama il metodo protetto ereditato
    return super.createGame(maxPlayers, entryFee, mbr, entryPayment, timerCommit, timerReveal)
  }
}
