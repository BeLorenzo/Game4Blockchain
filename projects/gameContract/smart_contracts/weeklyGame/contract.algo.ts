import { assert, BoxMap, bytes, clone, Global, gtxn, itxn, Txn, uint64 } from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { itob, sha256 } from '@algorandfoundation/algorand-typescript/op'
import { GameContract, GameConfig } from '../abstract_contract2/contract.algo'

/**
 * Contratto concreto per il gioco settimanale con approccio pull
 * I giocatori devono richiedere esplicitamente la loro vincita
 */
export class WeeklyGame extends GameContract {
  // BoxMap per tenere traccia del numero di giocatori per giorno per sessione
  dayCounts = BoxMap<bytes, uint64>({ keyPrefix: 'dc' })
  
  // BoxMap per tracciare quali giocatori hanno già ritirato il premio
  claimedWinnings = BoxMap<bytes, boolean>({ keyPrefix: 'clm' })

  /**
   * Crea una nuova sessione di gioco
   */
  public createNewSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    // Verifica timeline
    assert(config.startAt < config.endCommitAt, 'Timeline non valida')
    assert(config.endCommitAt < config.endRevealAt, 'Timeline non valida')
    
    // Calcola MBR aggiuntivo per le box dei giorni (7 giorni)
    const dayCountsMBR :uint64 = this.getBoxMBR(32, 8) * 7 // 7 box per i giorni
    const totalMBR = dayCountsMBR
    
    assert(mbrPayment.amount >= totalMBR, 'MBR insufficiente per le strutture dei giorni')

    // Delega al contratto padre
    return super.createSession(config, mbrPayment, 0)
  }

  /**
   * Rivela la scelta del giocatore e aggiorna il conteggio del giorno
   */
  public revealMove(sessionID: uint64, choice: uint64, salt: bytes): void {
    // Verifica che la scelta sia un giorno valido (0-6)
    assert(choice < 7, 'Giorno non valido: deve essere tra 0 e 6')
    
    // Chiama il reveal del contratto padre
    super.revealMove(sessionID, choice, salt)

    // Aggiorna il conteggio per il giorno scelto
    const dayKey = this.getDayKey(sessionID, choice)
    let currentCount : uint64
    if (this.dayCounts(dayKey).exists) currentCount = this.dayCounts(dayKey).value
    else currentCount = 0
    this.dayCounts(dayKey).value = currentCount + 1
  }

  /**
   * Permette a un giocatore di richiedere la propria vincita (approccio pull)
   */
  public claimWinnings(sessionID: uint64): void {
    assert(this.sessionExists(sessionID), 'Sessione non esistente')
    
    const config = clone(this.gameSessions(sessionID).value)
    const currentTime = Global.latestTimestamp
    
    // Verifica che il periodo di reveal sia terminato
    assert(currentTime >= config.endRevealAt, 'Sessione non ancora terminata')
    
    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)
    const claimKey = this.getClaimKey(sessionID, playerAddr)
    
    // Verifica che il giocatore abbia rivelato e non abbia già ritirato
    assert(this.playerChoice(playerKey).exists, 'Giocatore non ha rivelato la scelta')
    assert(!this.claimedWinnings(claimKey).exists, 'Premio già ritirato')
    
    // Calcola la vincita
    const amount = this.calculatePlayerWin(sessionID, playerAddr)
    assert(amount > 0, 'Nessuna vincita disponibile')
    
    // Marca come ritirato e distribuisci
    this.claimedWinnings(claimKey).value = true
    
    itxn.payment({
      receiver: playerAddr.bytes,
      amount: amount,
      fee: 0,
      closeRemainderTo: Global.zeroAddress
    }).submit()
  }

  /**
   * Calcola la vincita per un singolo giocatore
   */
  private calculatePlayerWin(sessionID: uint64, player: Address): uint64 {
    const totalBalance = this.getSessionBalance(sessionID)
    const playerKey = this.getPlayerKey(sessionID, player)
    const choice = this.playerChoice(playerKey).value
    
    assert(choice < 7, 'Scelta non valida nel calcolo premi')
    
    // Calcola il numero di giorni con almeno un giocatore
    let activeDays : uint64 = 0
    for (let day: uint64 = 0; day < 7; day = day + 1) {
      const dayKey = this.getDayKey(sessionID, day)
      if (this.dayCounts(dayKey).exists && this.dayCounts(dayKey).value > 0) {
        activeDays = activeDays + 1
      }
    }
    
    if (activeDays === 0) {
      return 0
    }
    
    // Calcola il premio per giorno
    const prizePerDay : uint64 = totalBalance / activeDays
    
    // Calcola il premio per giocatore nel giorno scelto
    const dayKey = this.getDayKey(sessionID, choice)
    const playersInDay = this.dayCounts(dayKey).value
    
    return prizePerDay / playersInDay
  }

  /**
   * Pulisce i dati della sessione dopo un certo periodo
   */
  public cleanupSession(sessionID: uint64): void {
    assert(this.sessionExists(sessionID), 'Sessione non esistente')
    
    const config = clone(this.gameSessions(sessionID).value)
    const currentTime = Global.latestTimestamp
    const cleanupTime : uint64 = config.endRevealAt + 604800 // 1 settimana dopo la fine
    
    assert(currentTime >= cleanupTime, 'Tempo di cleanup non ancora raggiunto')
    
    // Pulisce le box dei giorni
    for (let day: uint64 = 0; day < 7; day = day + 1) {
      const dayKey = this.getDayKey(sessionID, day)
      if (this.dayCounts(dayKey).exists) {
        this.dayCounts(dayKey).delete()
      }
    }
    //Clean up?
  }

  /**
   * Genera una chiave univoca per un giorno in una sessione
   */
  private getDayKey(sessionID: uint64, day: uint64): bytes {
    return sha256(itob(sessionID).concat(itob(day)))
  }

  /**
   * Genera una chiave per tracciare i ritiri
   */
  private getClaimKey(sessionID: uint64, player: Address): bytes {
    return sha256(itob(sessionID).concat(player.bytes))
  }
}