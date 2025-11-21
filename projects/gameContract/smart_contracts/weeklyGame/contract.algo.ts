import { assert, BoxMap, bytes, Global, gtxn, uint64 } from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { itob, sha256 } from '@algorandfoundation/algorand-typescript/op'
import { GameContract } from '../abstract_contract2/contract.algo'

interface GameConfig {
  startAt: uint64
  endCommitAt: uint64
  endRevealAt: uint64
  participation: uint64
}

interface WinningEntry {
  winner: Address
  amount: uint64
}

/**
 * Contratto concreto per il gioco settimanale dove i giocatori scelgono un giorno (0-6)
 * e i premi sono distribuiti in modo inversamente proporzionale al numero di giocatori per giorno.
 */
export class WeeklyGame extends GameContract {
  // BoxMap per tenere traccia del numero di giocatori per giorno per sessione
  // Chiave: hash(sessionID + day) -> count
  dayCounts = BoxMap<bytes, uint64>({ keyPrefix: 'dc' })

  /**
   * Crea una nuova sessione di gioco con pagamento MBR
   */
  public createNewSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    // Verifica che il pagamento MBR sia sufficiente
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment must be to contract')
    assert(mbrPayment.amount >= this.calculateRequiredMBR(), 'Insufficient MBR')

    // Delegata al contratto padre per la creazione della sessione
    return super.createSession(config)
  }

  /**
   * Rivela la scelta del giocatore e aggiorna il conteggio del giorno
   */
  public reveal(sessionID: uint64, choice: uint64, salt: bytes): void {
    // Verifica che la scelta sia un giorno valido (0-6)
    assert(choice < 7, 'Giorno non valido: deve essere tra 0 e 6')
    // Chiama il reveal del contratto padre per le verifiche base e il salvataggio della scelta
    super.revealMove(sessionID, choice, salt)

    // Aggiorna il conteggio per il giorno scelto
    const dayKey = this.getDayKey(sessionID, choice)
    const currentCount = this.dayCounts(dayKey).exists ? this.dayCounts(dayKey).value : 0
    this.dayCounts(dayKey).value = currentCount + 1
  }

  /**
   * Calcola la distribuzione dei premi in base ai giorni scelti dai giocatori
   */
  public calculateWinnings(sessionID: uint64): WinningEntry[] {
    const totalBalance = this.getSessionBalance(sessionID)
    const revealedPlayers = this.getRevealedPlayers(sessionID)

    // Se non ci sono giocatori che hanno rivelato, restituisce array vuoto
    if (revealedPlayers.length === 0) {
      return []
    }

    // Calcola G: numero di giorni con almeno un giocatore
    let daysWithPlayers: uint64 = 0
    for (let day: uint64 = 0; day < 7; day = day + 1) {
      const dayKey = this.getDayKey(sessionID, day)
      if (this.dayCounts(dayKey).exists && this.dayCounts(dayKey).value > 0) {
        daysWithPlayers = daysWithPlayers + 1
      }
    }

    // Se non ci sono giorni con giocatori, restituisce array vuoto
    if (daysWithPlayers === 0) {
      return []
    }

    // Calcola il premio per giorno e per giocatore
    const prizePerDay = totalBalance / daysWithPlayers
    const entries: WinningEntry[] = []
    let totalDistributed: uint64 = 0

    for (const player of revealedPlayers) {
      const choice = this.getPlayerChoice(sessionID, player)
      assert(choice < 7, 'Scelta non valida nel calcolo premi')

      const dayKey = this.getDayKey(sessionID, choice)
      const countForDay = this.dayCounts(dayKey).value
      const amount = prizePerDay / countForDay

      entries.push({
        winner: player,
        amount: amount,
      })
      totalDistributed = totalDistributed + amount
    }

    // Gestione del resto per evitare perdite di fondi
    const remainder = totalBalance - totalDistributed
    if (remainder > 0 && entries.length > 0) {
      // Aggiunge il resto al primo giocatore nella lista
      entries[0].amount = entries[0].amount + remainder
    }

    return entries
  }

  /**
   * Metodo pubblico per finalizzare una sessione scaduta
   * Può essere chiamato da chiunque dopo la scadenza
   */
  public finalizeExpiredSession(sessionID: uint64): void {
    // Verifica che la sessione sia scaduta e finalizza
    const config = this.getSessionConfig(sessionID)
    const currentTime = Global.latestTimestamp
    assert(currentTime >= config.endRevealAt, 'Sessione non ancora scaduta')
    this.finalizeSession(sessionID)
  }

  /**
   * Calcola il MBR richiesto per creare una sessione
   * Considera le box aggiuntive per i conteggi dei giorni
   */
  private calculateRequiredMBR(): uint64 {
    // Stima: 20,000 microAlgos (0.02 ALGO)
    // Copre le box del contratto base più 7 box per i dayCounts
    return 20000
  }

  /**
   * Genera una chiave univoca per un giorno in una sessione
   */
  private getDayKey(sessionID: uint64, day: uint64): bytes {
    return sha256(itob(sessionID).concat(itob(day)))
  }
}
