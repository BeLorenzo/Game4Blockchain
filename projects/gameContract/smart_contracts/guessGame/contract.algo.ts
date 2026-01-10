import {
  assert,
  BoxMap,
  bytes,
  clone,
  ensureBudget,
  Global,
  gtxn,
  itxn,
  op,
  Txn,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { GameConfig, GameContract } from '../abstract_contract/contract.algo'

/**
 * Statistics for a specific game session.
 */
interface GameStats {
  sum: uint64
  count: uint64
}

/**
 * Implementation of the "Guess 2/3 of the Average" game.
 *
 * Game Mechanics:
 * - Players choose a number between 0 and 100.
 * - The system calculates the average of all choices.
 * - The Target is defined as 2/3 of that average.
 * - The winner is the player whose number is closest to the Target.
 * - In case of a tie, the pot is split equally among the winners.
 */
export class GuessGame extends GameContract {
  /**
   * Stores global session statistics required to calculate the average.
   * Key: SessionID
   */
  stats = BoxMap<uint64, GameStats>({ keyPrefix: 'st' })

  /**
   * Compressed frequency map storing player choices.
   * Structure: A single byte blob of 808 bytes (101 uint64s).
   * Index 'i' (0-100) holds the count of players who chose 'i'.
   * Key: SessionID
   */
  frequency = BoxMap<uint64, bytes>({ keyPrefix: 'fr' })

  /**
   * Initializes a new game session and allocates storage for counters.
   * Validates that the MBR payment covers the large frequency blob.
   */
  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    const requiredMBR = this.getRequiredMBR('newGame')

    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount >= requiredMBR, 'Insufficient MBR for session and counters')

    const sessionID = super.create(config)

    this.stats(sessionID).value = { sum: 0, count: 0 }

    // Initialize the frequency blob with zeros (101 * 8 bytes = 808 bytes).
    this.frequency(sessionID).value = op.bzero(808)

    return sessionID
  }

  /**
   * Allows a player to join the session.
   */
  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn): void {
    super.join(sessionID, commit, payment)
  }

  /**
   * Reveals a player's move and updates global game statistics.
   * Choice must be between 0 and 100.
   */
  public revealMove(sessionID: uint64, choice: uint64, salt: bytes): void {
    assert(choice >= 0 && choice <= 100, 'Choice must be between 0 and 100')

    super.reveal(sessionID, choice, salt)

    // Update global sum and count
    const currentStats = clone(this.stats(sessionID).value)
    currentStats.sum += choice
    currentStats.count += 1
    this.stats(sessionID).value = clone(currentStats)

    // Update frequency counter for the specific choice within the blob
    // Offset calculation: choice * 8 bytes (size of uint64)
    const offset: uint64 = choice * 8
    const box = this.frequency(sessionID)
    const currentCount = op.extractUint64(box.value, offset)
    const newCount: uint64 = currentCount + 1

    // Write only the updated 8 bytes back to storage
    box.replace(offset, op.itob(newCount))
  }

  /**
   * Calculates the winner and distributes the prize using the Pull pattern.
   * Uses ensureBudget to guarantee sufficient opcodes for the calculation loop.
   */
  public claimWinnings(sessionID: uint64): uint64 {
    ensureBudget(1400)
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const config = clone(this.gameSessions(sessionID).value)
    const currentTime = Global.round

    assert(currentTime > config.endRevealAt, 'Game is not finished yet')

    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)

    assert(this.playerChoice(playerKey).exists, 'Player has not revealed or already claimed')

    const myChoice = this.playerChoice(playerKey).value
    const prizeAmount = this.calculatePlayerWin(sessionID, myChoice)

    assert(prizeAmount > 0, 'You did not win or no pot available')

    // Cleanup state to prevent double spending and recover MBR
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
   * Internal logic to determine if the caller is a winner and calculate their share.
   *
   * Algorithm:
   * 1. Calculate Target = (Sum * 2) / (Count * 3).
   * 2. Perform a radial search expanding from the Target to find the nearest chosen number(s).
   * 3. Verify if the caller's choice matches the winning distance.
   */
  private calculatePlayerWin(sessionID: uint64, myChoice: uint64): uint64 {
    const stats = clone(this.stats(sessionID).value)

    if (stats.count === 0) return 0

    // Calculate Target: (Sum * 2) / (Count * 3)
    // Multiplication is performed first to preserve integer precision.
    const target: uint64 = (stats.sum * 2) / (stats.count * 3)

    const freqBlob = this.frequency(sessionID).value
    let winningDistance: uint64 = 101 // Sentinel value > max possible distance (100)
    let totalWinners: uint64 = 0

    // Search loop: Find the minimum distance to the target that has at least one player
    for (let dist: uint64 = 0; dist <= 100; dist++) {
      let found = false

      // Check lower bound (Target - dist)
      if (target >= dist) {
        const lowVal: uint64 = target - dist
        const countLow = op.extractUint64(freqBlob, lowVal * 8)
        if (countLow > 0) {
          totalWinners += countLow
          found = true
        }
      }

      // Check upper bound (Target + dist)
      // Ensure we don't double count if dist is 0 (where lowVal == highVal)
      if (dist > 0 && target + dist <= 100) {
        const highVal: uint64 = target + dist
        const countHigh = op.extractUint64(freqBlob, highVal * 8)
        if (countHigh > 0) {
          totalWinners += countHigh
          found = true
        }
      }

      if (found) {
        winningDistance = dist
        break // Nearest distance found, stop searching
      }
    }

    // Verify if the caller is among the winners
    let isWinner = false
    if (myChoice <= target) {
      if (target - myChoice === winningDistance) isWinner = true
    } else {
      if (myChoice - target === winningDistance) isWinner = true
    }

    if (!isWinner) return 0

    const totalPot = this.getSessionBalance(sessionID)

    if (totalWinners === 0) return 0

    return totalPot / totalWinners
  }

  /**
   * Calculates the required Minimum Balance Requirement (MBR) for storage allocation.
   */
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      // Stats Box: Key (8 bytes) + Struct (16 bytes)
      const statsMBR = this.getBoxMBR(8, 16)

      // Frequency Box: Key (8 bytes) + Blob (101 * 8 = 808 bytes)
      const freqMBR = this.getBoxMBR(8, 808)

      return statsMBR + freqMBR + super.getRequiredMBR('newGame')
    }
    return super.getRequiredMBR(command)
  }
}
