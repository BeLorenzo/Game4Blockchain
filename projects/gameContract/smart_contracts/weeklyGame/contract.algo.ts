import { assert, BoxMap, bytes, clone, Global, gtxn, itxn, Txn, uint64 } from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { GameConfig, GameContract } from '../abstract_contract/contract.algo'

interface daysCount {
  lun: uint64
  mar: uint64
  mer: uint64
  gio: uint64
  ven: uint64
  sab: uint64
  dom: uint64
}

export class WeeklyGame extends GameContract {
  /**
   * Mappa che tiene il conteggio dei giocatori per ogni giorno (0-6) di ogni sessione.
   * Key: SHA256(SessionID + DayIndex)
   * Value: Numero di giocatori che hanno scelto quel giorno
   */
  days = BoxMap<uint64, daysCount>({ keyPrefix: 'dc' })

  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    // 1. Calcola MBR totale: MBR base sessione + MBR per le 7 box dei giorni
    const daysMBR = this.getRequiredMBR('newGame')

    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount >= daysMBR, 'Insufficient MBR for session and day counters')

    // 2. Crea la sessione base
    const sessionID = super.create(config)

    // 3. Inizializza le 7 box per i giorni (0-6) a 0
    // Questo è fondamentale per riservare lo storage pagato dall'MBR
    const init: daysCount = { lun: 0, mar: 0, mer: 0, gio: 0, ven: 0, sab: 0, dom: 0 }
    this.days(sessionID).value = clone(init)

    return sessionID
  }

  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn): void {
    // Wrapper semplice del join padre
    super.join(sessionID, commit, payment)
  }

  public revealMove(sessionId: uint64, choice: uint64, salt: bytes): void {
    // 2. Esegue logica di reveal standard (verifica hash e salva choice)
    super.reveal(sessionId, choice, salt)

    const dayBox = this.days(sessionId)

    // opzionale: assicurati che esista
    const [current, exists] = clone(dayBox.maybe())
    assert(exists, 'Day counters not initialized')

    switch (choice) {
      case 0:
        current.lun = current.lun + 1
        break
      case 1:
        current.mar = current.mar + 1
        break
      case 2:
        current.mer = current.mer + 1
        break
      case 3:
        current.gio = current.gio + 1
        break
      case 4:
        current.ven = current.ven + 1
        break
      case 5:
        current.sab = current.sab + 1
        break
      case 6:
        current.dom = current.dom + 1
        break
      default:
        assert(false, 'Invalid Day: must be between 0 and 6')
    }

    // riscrivi il valore aggiornato nella box
    dayBox.value = clone(current)
  }

  /**
   * Distribuisce la vincita al chiamante se eleggibile.
   * Pattern: PULL
   */
  public claimWinnings(sessionID: uint64): uint64 {
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const config = clone(this.gameSessions(sessionID).value)
    const currentTime = Global.round

    // 1. Verifica Fase Temporale
    assert(currentTime > config.endRevealAt, 'Game is not finished yet')
    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)

    // 2. Verifica Eleggibilità
    // Se la box choice non esiste, o l'utente non ha rivelato o ha già reclamato
    assert(this.playerChoice(playerKey).exists, 'Player has not revealed or already claimed')

    const choice = this.playerChoice(playerKey).value

    // 3. Calcolo Vincita
    const prizeAmount = this.calculatePlayerWin(sessionID, choice)

    // Se prizeAmount è 0 (es. casi limite matematici), evitiamo transazioni vuote
    assert(prizeAmount > 0, 'No winnings calculated')

    // 4. Cleanup Utente (Anti-Replay)
    // Cancellando la box choice, l'assert al punto 2 fallirà se richiamato.
    // Inoltre recuperiamo MBR che rimane nel contratto (o rimborsabile se implementi reclaimMBR separato)
    this.playerChoice(playerKey).delete()

    // 5. Invio Pagamento
    itxn
      .payment({
        receiver: playerAddr.native,
        amount: prizeAmount,
        fee: 0,
      })
      .submit()

    return prizeAmount
  }

  private calculatePlayerWin(sessionID: uint64, playerChoice: uint64): uint64 {
    const totalPot = this.getSessionBalance(sessionID)

    // recupero struct con i contatori per tutti i giorni
    const counters = clone(this.days(sessionID).value)

    // 1. conta quanti giorni hanno almeno 1 giocatore
    let activeDaysCount: uint64 = 0

    if (counters.lun > 0) activeDaysCount += 1
    if (counters.mar > 0) activeDaysCount += 1
    if (counters.mer > 0) activeDaysCount += 1
    if (counters.gio > 0) activeDaysCount += 1
    if (counters.ven > 0) activeDaysCount += 1
    if (counters.sab > 0) activeDaysCount += 1
    if (counters.dom > 0) activeDaysCount += 1

    if (activeDaysCount === 0) return 0

    // 2. piatto per giorno attivo
    const potPerDay: uint64 = totalPot / activeDaysCount

    // 3. numero di giocatori nel giorno scelto
    let playersInThatDay: uint64 = 0
    switch (playerChoice) {
      case 0:
        playersInThatDay = counters.lun
        break
      case 1:
        playersInThatDay = counters.mar
        break
      case 2:
        playersInThatDay = counters.mer
        break
      case 3:
        playersInThatDay = counters.gio
        break
      case 4:
        playersInThatDay = counters.ven
        break
      case 5:
        playersInThatDay = counters.sab
        break
      case 6:
        playersInThatDay = counters.dom
        break
      default:
        return 0 // o assert se la scelta deve essere valida
    }

    if (playersInThatDay === 0) return 0

    return potPerDay / playersInThatDay
  }

  /**
   * Calcolo MBR specifico
   */
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      // Calcolo per le 7 Box dei contatori
      const singleBoxMBR = this.getBoxMBR(10, 56)
      const allDaysMBR: uint64 = singleBoxMBR * 7

      return allDaysMBR + super.getRequiredMBR('newGame')
    }
    return super.getRequiredMBR(command)
  }
}
