import { assert, BoxMap, bytes, clone, Global, gtxn, itxn, Txn, uint64 } from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { GameConfig, GameContract } from '../abstract_contract/contract.algo'

/**
 * Stores the number of players for each weekday.
 */
interface daysCount {
  lun: uint64
  mar: uint64
  mer: uint64
  gio: uint64
  ven: uint64
  sab: uint64
  dom: uint64
}

/**
 * WeeklyGame contract.
 *
 * Players choose a weekday.
 * The total pot is split across active days and then among players
 * who selected the same day.
 */
export class WeeklyGame extends GameContract {
  /**
   * Weekday counters per session.
   * Initialized at session creation time to reserve MBR.
   */
  days = BoxMap<uint64, daysCount>({ keyPrefix: 'dc' })

  /**
   * Creates a new session and initializes weekday counters.
   */
  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    const daysMBR = this.getRequiredMBR('newGame')

    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount >= daysMBR, 'Insufficient MBR for session and day counters')

    const sessionID = super.create(config)

    // Mandatory initialization to allocate paid box storage
    const init: daysCount = { lun: 0, mar: 0, mer: 0, gio: 0, ven: 0, sab: 0, dom: 0 }
    this.days(sessionID).value = clone(init)

    return sessionID
  }

  /**
   * Joins an existing session.
   */
  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn): void {
    super.join(sessionID, commit, payment)
  }

  /**
   * Reveals the committed move and updates weekday counters.
   */
  public revealMove(sessionId: uint64, choice: uint64, salt: bytes): void {
    super.reveal(sessionId, choice, salt)

    const dayBox = this.days(sessionId)

    // Defensive check: counters must exist if session was initialized correctly
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

    dayBox.value = clone(current)
  }

  /**
   * Allows an eligible player to claim their winnings.
   * Uses a pull-based payout pattern.
   */
  public claimWinnings(sessionID: uint64): uint64 {
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const config = clone(this.gameSessions(sessionID).value)
    assert(Global.round > config.endRevealAt, 'Game is not finished yet')

    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)

    // Fails if the player did not reveal or already claimed
    assert(this.playerChoice(playerKey).exists, 'Player has not revealed or already claimed')

    const choice = this.playerChoice(playerKey).value
    const prizeAmount = this.calculatePlayerWin(sessionID, choice)

    // Prevent zero-value payouts and useless inner transactions
    assert(prizeAmount > 0, 'No winnings calculated')

    // Anti-replay: deleting the box makes this function callable only once
    this.playerChoice(playerKey).delete()

    itxn
      .payment({
        receiver: playerAddr.native,
        amount: prizeAmount,
        fee: 0,
      })
      .submit()

    return prizeAmount
  }

  /**
   * Computes the winnings for a player based on their chosen weekday.
   */
  private calculatePlayerWin(sessionID: uint64, playerChoice: uint64): uint64 {
    const totalPot = this.getSessionBalance(sessionID)
    const counters = clone(this.days(sessionID).value)

    let activeDaysCount: uint64 = 0

    if (counters.lun > 0) activeDaysCount += 1
    if (counters.mar > 0) activeDaysCount += 1
    if (counters.mer > 0) activeDaysCount += 1
    if (counters.gio > 0) activeDaysCount += 1
    if (counters.ven > 0) activeDaysCount += 1
    if (counters.sab > 0) activeDaysCount += 1
    if (counters.dom > 0) activeDaysCount += 1

    if (activeDaysCount === 0) return 0

    const potPerDay: uint64 = totalPot / activeDaysCount

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
        return 0
    }

    return playersInThatDay === 0 ? 0 : potPerDay / playersInThatDay
  }

  /**
   * Returns the required MBR for the given command.
   */
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      const singleBoxMBR = this.getBoxMBR(10, 56)
      const allDaysMBR: uint64 = singleBoxMBR * 7
      return allDaysMBR + super.getRequiredMBR('newGame')
    }
    return super.getRequiredMBR(command)
  }
}
