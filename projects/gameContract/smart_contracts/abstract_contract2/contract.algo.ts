import {
  assert,
  BoxMap,
  bytes,
  clone,
  Contract,
  Global,
  GlobalState,
  gtxn,
  Txn,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { itob, sha256 } from '@algorandfoundation/algorand-typescript/op'

interface GameConfig {
  startAt: uint64 // Timestamp: Game start time
  endCommitAt: uint64 // Timestamp: Commit phase deadline
  endRevealAt: uint64 // Timestamp: Reveal phase deadline
  participation: uint64 // Entry fee in microAlgo
  sessionCreator: Address // Address of the session administrator
}

/**
 * Abstract contract implementing a generic Commit-Reveal scheme for N-player games.
 * * @abstract
 * @description
 * Implements the full lifecycle of a secure game session:
 * 1. Creation (MBR reservation for config)
 * 2. Joining (Commit hash + MBR reservation for player data)
 * 3. Revealing (Verifying hash against choice)
 * 4. MBR Reclaim (Refund mechanism for storage costs)
 * * The subclass is responsible for implementing the `calculateWinnings` logic
 * or real-time winner tracking.
 */
export class GameContract extends Contract {
  /** * Global monotonic counter for generating unique session IDs.
   */
  sessionIDCounter = GlobalState<uint64>({ initialValue: 0 })

  /** * Storage for player commits.
   * Key: Hash(sessionID + playerAddress) [36 bytes]
   * Value: Hash(choice + salt) [32 bytes]
   */
  playerCommit = BoxMap<bytes, bytes>({ keyPrefix: 'pcom' })

  /** * Storage for revealed choices.
   * Key: Hash(sessionID + playerAddress) [36 bytes]
   * Value: Player Choice [8 bytes]
   */
  playerChoice = BoxMap<bytes, uint64>({ keyPrefix: 'pcho' })

  /** * Configuration storage for each active session.
   */
  gameSessions = BoxMap<uint64, GameConfig>({ keyPrefix: 'gs' })

  /** * Tracks the total pot (collected participation fees) for a specific session.
   */
  sessionBalances = BoxMap<uint64, uint64>({ keyPrefix: 'sbal' })

  /**
   * Initializes a new game session and reserves storage.
   * * @param config - The configuration object defining timelines and fees.
   * @param mbrPayment - Payment transaction covering MBR for session config and balance boxes.
   * @returns The unique uint64 ID of the newly created session.
   * @throws Error if timelines are invalid or MBR payment is incorrect.
   */
  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    // 1. Verify timeline consistency
    assert(config.startAt < config.endCommitAt, 'Invalid timeline: start must be before commit end')
    assert(config.endCommitAt < config.endRevealAt, 'Invalid timeline: commit end must be before reveal end')
    assert(config.startAt >= Global.latestTimestamp, 'Invalid start time: cannot start in the past')

    // 2. Calculate strict MBR requirements
    // Box 'gs': Key (2 prefix + 8 ID = 10) + Value (64 bytes struct)
    const configMBR = this.getBoxMBR(10, 64)

    // Box 'sbal': Key (4 prefix + 8 ID = 12) + Value (8 bytes uint64)
    const balanceMBR = this.getBoxMBR(12, 8)

    const totalMBR: uint64 = configMBR + balanceMBR

    // 3. Verify payment
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment must be sent to contract')
    assert(mbrPayment.amount === totalMBR, 'Payment must cover exact MBR for session config and balance')

    const sessionID = this.sessionIDCounter.value

    // 4. Initialize storage
    this.gameSessions(sessionID).value = clone(config)
    this.sessionBalances(sessionID).value = 0
    this.sessionIDCounter.value = sessionID + 1

    return sessionID
  }

  /**
   * Allows a player to join an active session by committing a hashed move.
   * * @param sessionID - The target session ID.
   * @param commit - The SHA256 hash of the player's move (choice + salt).
   * @param payment - The participation fee payment.
   * @param mbrPayment - The MBR payment for the player's storage box.
   */
  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn, mbrPayment: gtxn.PaymentTxn): void {
    assert(this.gameSessions(sessionID).exists, 'Session does not exist')
    const config = clone(this.gameSessions(sessionID).value)
    const currentTime = Global.latestTimestamp

    // 1. Verify State & Time
    assert(currentTime >= config.startAt, 'Game session has not started yet')
    assert(currentTime <= config.endCommitAt, 'Commit phase has ended')

    // 2. Verify Participation Fee
    assert(payment.receiver === Global.currentApplicationAddress, 'Fee receiver must be the contract')
    assert(payment.amount === config.participation, 'Incorrect participation fee amount')

    // 3. Verify MBR Payment
    // Key: Prefix(4) + SHA256(32) = 36 bytes | Value: SHA256(32) = 32 bytes
    const requiredMBR = this.getBoxMBR(36, 32)
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount === requiredMBR, 'Insufficient MBR payment for player storage')

    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)

    // 4. Persist Data
    assert(!this.playerCommit(playerKey).exists, 'Player already registered in this session')

    this.playerCommit(playerKey).value = commit
    this.sessionBalances(sessionID).value += payment.amount
  }

  /**
   * Reveals a player's previously committed move during the reveal phase.
   * Swaps the 'Commit' box for a smaller 'Choice' box.
   * * @param sessionID - The session ID.
   * @param choice - The actual move (uint64).
   * @param salt - The secret salt used for the commit hash.
   */
  public revealMove(sessionID: uint64, choice: uint64, salt: bytes): void {
    assert(this.gameSessions(sessionID).exists, 'Session does not exist')

    const config = clone(this.gameSessions(sessionID).value)
    const currentTime = Global.latestTimestamp

    // 1. Verify Time
    assert(currentTime >= config.endCommitAt, 'Commit phase is still active')
    assert(currentTime <= config.endRevealAt, 'Reveal phase has ended')

    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)

    assert(this.playerCommit(playerKey).exists, 'No commit found for this player')

    // 2. Verify Hash
    const storedCommit = this.playerCommit(playerKey).value
    const computedCommit = sha256(itob(choice).concat(salt))

    assert(computedCommit === storedCommit, 'Invalid reveal: hash mismatch')

    // 3. Store Choice & Cleanup Commit
    // Note: We delete the 32-byte commit and create an 8-byte choice.
    // The MBR surplus remains in the contract balance until `reclaimMBR` is called.
    this.playerChoice(playerKey).value = choice
    this.playerCommit(playerKey).delete()
  }

  /**
   * refunds the Minimum Balance Requirement (MBR) to the player.
   * This method can be called after the game ends, regardless of whether
   * the session still exists or has been cleaned up.
   * * @param sessionID - The session ID.
  public reclaimMBR(sessionID: uint64): void {
    // 1. Safety Check (Only if session still exists)
    if (this.gameSessions(sessionID).exists) {
      assert(Global.latestTimestamp >= this.gameSessions(sessionID).value.endRevealAt, 'Game is still active')
    }
    
    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)
    
    // 2. Determine Refund Amount
    // We always refund the *original* max deposit (for 32-byte value),
    // ensuring the user gets back everything they paid during joinSession.
    // Key(36) + Value(32)
    const originalDepositMBR = this.getBoxMBR(36, 32)
    
    // 3. Cleanup Player Data
    if (this.playerChoice(playerKey).exists) {
      this.playerChoice(playerKey).delete()
    } else if (this.playerCommit(playerKey).exists) {
      this.playerCommit(playerKey).delete()
    } else {
      // No data found, nothing to refund.
    return
  }
  
  // 4. Execute Refund (Inner Transaction)
  itxn
  .payment({
    receiver: playerAddr.native,
    amount: originalDepositMBR,
    fee: 0,
  })
  .submit()
}
*/

  /**
   * Deletes global session data (Config & Balance).
   * Does NOT delete individual player data (players must call reclaimMBR).
   * * @param sessionID - The ID of the session to delete.
   */
  protected cleanupSession(sessionID: uint64): void {
    assert(Global.latestTimestamp >= this.gameSessions(sessionID).value.endRevealAt, 'Cannot cleanup active session')

    this.gameSessions(sessionID).delete()
    this.sessionBalances(sessionID).delete()
  }

  /**
   * Calculates the Algorand Minimum Balance Requirement for a box.
   * Formula: 2500 + 400 * (KeySize + ValueSize)
   */
  private getBoxMBR(keySize: uint64, valueSize: uint64): uint64 {
    return 2500 + 400 * (keySize + valueSize)
  }

  /**
   * Helper to retrieve a player's choice safely.
   */
  protected getPlayerChoice(sessionID: uint64, player: Address): uint64 {
    const key = this.getPlayerKey(sessionID, player)
    assert(this.playerChoice(key).exists, 'Player choice not found')
    return this.playerChoice(key).value
  }

  protected getSessionBalance(sessionID: uint64): uint64 {
    assert(this.sessionBalances(sessionID).exists, 'Session does not exist')
    return this.sessionBalances(sessionID).value
  }

  protected sessionExists(sessionID: uint64): boolean {
    return this.gameSessions(sessionID).exists
  }

  /**
   * Generates the storage key for player data.
   * Format: SHA256(sessionID + playerAddress) -> 32 Bytes
   */
  private getPlayerKey(sessionID: uint64, player: Address): bytes {
    return sha256(itob(sessionID).concat(player.bytes))
  }
}
