import { gtxn, uint64 } from '@algorandfoundation/algorand-typescript'
import { AbstractGameContract } from '../abstract_contract/contract.algo'
import { GameState } from '../abstract_contract/gameState.algo'

/**
 * Un contratto concreto usato SOLO per i test.
 * Espone i metodi protetti (come createGame) per poterli testare.
 */
export class ProvaConcreteContract extends AbstractGameContract {
  /**
   * Implementazione "vuota" (no-op) richiesta dall'astratto.
   * Ci permette di testare il resto senza che `reveal` fallisca.
   */
  protected chooseWinner(game: GameState): void {
    // Non fare nulla, è solo un segnaposto per i test
    return
  }

  /**
   * METODO PUBBLICO DI TEST:
   * Espone il metodo 'protected createGame' per i test di unità.
   */
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
