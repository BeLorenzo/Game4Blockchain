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

/**
 * Configuration for a game session.
 * Note: Timelines are based on Block Rounds, not timestamps.
 */
export interface GameConfig {
  startAt: uint64 // Round: Game start
  endCommitAt: uint64 // Round: Commit phase deadline
  endRevealAt: uint64 // Round: Reveal phase deadline
  participation: uint64 // Entry fee in microAlgo
}

/**
 * Abstract contract implementing a generic Commit-Reveal scheme for N-player games.
 *
 * @abstract
 * @description
 * Implements the full lifecycle of a secure game session:
 * 1. Creation (MBR reservation for config)
 * 2. Joining (Commit hash + MBR reservation for player data)
 * 3. Revealing (Verifying hash against choice)
 *
 * The subclass is responsible for implementing the logic of the game.
 */
export class GameContract extends Contract {
  /**
   * Global counter for generating unique session IDs.
   */
  sessionIDCounter = GlobalState<uint64>({ initialValue: 0 })

  /**
   * Storage for player commits.
   * Key: Hash(sessionID + playerAddress) [36 bytes]
   * Value: Hash(choice + salt) [32 bytes]
   */
  playerCommit = BoxMap<bytes, bytes>({ keyPrefix: 'pcom' })

  /**
   * Storage for revealed choices.
   * Key: Hash(sessionID + playerAddress) [36 bytes]
   * Value: Player Choice [8 bytes]
   */
  playerChoice = BoxMap<bytes, uint64>({ keyPrefix: 'pcho' })

  /**
   * Configuration storage for each active session.
   */
  gameSessions = BoxMap<uint64, GameConfig>({ keyPrefix: 'gs' })

  /**
   * Tracks the total pot (collected participation fees) for a specific session.
   */
  sessionBalances = BoxMap<uint64, uint64>({ keyPrefix: 'sbal' })

  /**
   * Initializes a new game session and reserves storage.
   *
   * @param config - The configuration object defining timelines and fees.
   * @returns The unique uint64 ID of the newly created session.
   */
  protected create(config: GameConfig): uint64 {
    assert(config.startAt <= config.endCommitAt, 'Invalid timeline: start must be before commit end')
    assert(config.endCommitAt < config.endRevealAt, 'Invalid timeline: commit end must be before reveal end')
    assert(config.startAt >= Global.round, 'Invalid start time: cannot start in the past')

    const sessionID = this.sessionIDCounter.value

    this.gameSessions(sessionID).value = clone(config)
    this.sessionBalances(sessionID).value = 0
    this.sessionIDCounter.value = sessionID + 1

    return sessionID
  }

  /**
   * Allows a player to join an active session by committing a hashed move.
   *
   * @param sessionID - The target session ID.
   * @param commit - The SHA256 hash of the player's move (choice + salt).
   * @param payment - The participation fee payment.
   */
  protected join(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn): void {
    assert(this.gameSessions(sessionID).exists, 'Session does not exist')

    const config = clone(this.gameSessions(sessionID).value)
    const currentBlock = Global.round

    assert(currentBlock >= config.startAt, 'Game session has not started yet')
    assert(currentBlock <= config.endCommitAt, 'Commit phase has ended')

    assert(payment.receiver === Global.currentApplicationAddress, 'Fee receiver must be the contract')
    assert(payment.amount === config.participation, 'Incorrect participation fee amount')

    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)

    assert(!this.playerCommit(playerKey).exists, 'Player already registered in this session')

    this.playerCommit(playerKey).value = commit
    this.sessionBalances(sessionID).value += payment.amount
  }

  /**
   * Reveals a player's previously committed move during the reveal phase.
   *
   * @param sessionID - The session ID.
   * @param choice - The actual move (uint64).
   * @param salt - The secret salt used for the commit hash.
   */
  protected reveal(sessionID: uint64, choice: uint64, salt: bytes): void {
    assert(this.gameSessions(sessionID).exists, 'Session does not exist')

    const config = clone(this.gameSessions(sessionID).value)
    const currentBlock = Global.round

    assert(currentBlock > config.endCommitAt, 'Commit phase is still active')
    assert(currentBlock <= config.endRevealAt, 'Reveal phase has ended')

    const playerAddr = new Address(Txn.sender)
    const playerKey = this.getPlayerKey(sessionID, playerAddr)

    assert(this.playerCommit(playerKey).exists, 'No commit found for this player')

    const storedCommit = this.playerCommit(playerKey).value
    const computedCommit = sha256(itob(choice).concat(salt))

    assert(computedCommit === storedCommit, 'Invalid reveal: hash mismatch')

    this.playerChoice(playerKey).value = choice
    this.playerCommit(playerKey).delete()
  }

  /**
   * Calculates the Algorand Minimum Balance Requirement (MBR) for a box.
   * Formula: 2500 + 400 * (KeySize + ValueSize)
   */
  protected getBoxMBR(keySize: uint64, valueSize: uint64): uint64 {
    return 2500 + 400 * (keySize + valueSize)
  }

  /**
   * Returns the total MBR required for specific game actions.
   */
  protected getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      // Box 'gs': Key (2 prefix + 8 ID = 10) + Value (64 bytes struct)
      const configMBR = this.getBoxMBR(10, 64)
      // Box 'sbal': Key (4 prefix + 8 ID = 12) + Value (8 bytes uint64)
      const balanceMBR = this.getBoxMBR(12, 8)
      return configMBR + balanceMBR
    } else if (command === 'join') {
      // Player commit box: Key (4 prefix + 32 SHA256 = 36) + Value (32 SHA256)
      return this.getBoxMBR(36, 32)
    }
    assert(false, 'Command not supported')
  }

  /**
   * Helper to retrieve a player's choice.
   */
  protected getPlayerChoice(sessionID: uint64, player: Address): uint64 {
    const key = this.getPlayerKey(sessionID, player)
    assert(this.playerChoice(key).exists, 'Player choice not found')
    return this.playerChoice(key).value
  }

  /**
   * Helper to retrieve a session game balance.
   */
  protected getSessionBalance(sessionID: uint64): uint64 {
    assert(this.sessionBalances(sessionID).exists, 'Session does not exist')
    return this.sessionBalances(sessionID).value
  }

  /**
   * Helper to find out if a session exists
   */
  protected sessionExists(sessionID: uint64): boolean {
    return this.gameSessions(sessionID).exists
  }

  /**
   * Generates the storage key for player data.
   * Format: SHA256(sessionID + playerAddress) -> 32 Bytes
   */
  protected getPlayerKey(sessionID: uint64, player: Address): bytes {
    return sha256(itob(sessionID).concat(player.bytes))
  }
}
