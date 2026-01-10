import type { bytes, uint64 } from '@algorandfoundation/algorand-typescript'
import { assert, BoxMap, clone, Global, gtxn, itxn, Txn, Uint64 } from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { GameConfig, GameContract } from '../abstract_contract/contract.algo'

/**
 * Stores the two players participating in a session.
 */
interface SessionPlayers {
  p1: Address
  p2: Address
}

/**
 * Rock-Paper-Scissors implementation for 2 players.
 * Extends GameContract to handle commits, reveals, and winner distribution.
 */
export class RockPaperScissors extends GameContract {
  /**
   * Maps SessionID to the two player addresses.
   */
  sessionPlayers = BoxMap<uint64, SessionPlayers>({ keyPrefix: 'spl' })

  /**
   * Tracks whether the game has finished to prevent double payouts.
   * 0 = Active, 1 = Finished
   */
  gameFinished = BoxMap<uint64, uint64>({ keyPrefix: 'gfn' })

  /**
   * Creates a new RPS session.
   * Ensures MBR covers storage for player slots and game status.
   */
  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    const totalMBR: uint64 = this.getRequiredMBR('newGame')

    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment must be sent to contract')
    assert(mbrPayment.amount === totalMBR, 'Payment must cover exact MBR for session data')

    const sessionID = super.create(config)

    const zeroAddress = Global.zeroAddress
    this.sessionPlayers(sessionID).value = {
      p1: new Address(zeroAddress),
      p2: new Address(zeroAddress),
    }
    this.gameFinished(sessionID).value = 0

    return sessionID
  }

  /**
   * Allows a player to join the session, assigning them to an empty slot.
   * Enforces a maximum of 2 players per session.
   */
  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn, mbrPayment: gtxn.PaymentTxn): void {
    assert(this.sessionExists(sessionID), 'Session does not exist')
    assert(!this.gameFinished(sessionID).value, 'Game already finished')

    const players = clone(this.sessionPlayers(sessionID).value)
    const senderAddress = new Address(Txn.sender)
    const zeroAddress = new Address(Global.zeroAddress)

    assert(
      players.p1.native !== senderAddress.native && players.p2.native !== senderAddress.native,
      'Player already joined this session',
    )

    const requiredMBR: uint64 = this.getRequiredMBR('join')
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount === requiredMBR, 'Insufficient MBR payment for player storage')

    if (players.p1.native === zeroAddress.native) {
      players.p1 = senderAddress
    } else if (players.p2.native === zeroAddress.native) {
      players.p2 = senderAddress
    } else {
      assert(false, 'Session is full (Max 2 players)')
    }
    super.join(sessionID, commit, payment)

    this.sessionPlayers(sessionID).value = clone(players)
  }

  /**
   * Reveals a player's move. If both players revealed, triggers winner calculation.
   */
  public revealMove(sessionID: uint64, choice: uint64, salt: bytes): void {
    assert(choice < Uint64(3), 'Invalid choice: must be 0, 1, or 2')
    assert(!this.gameFinished(sessionID).value, 'Game already finished')

    super.reveal(sessionID, choice, salt)

    const players = clone(this.sessionPlayers(sessionID).value)
    const zeroAddress = new Address(Global.zeroAddress)

    if (players.p2.native === zeroAddress.native) {
      this.distributePrize(new Address(Txn.sender), this.getSessionBalance(sessionID))
      this.gameFinished(sessionID).value = 1
      return
    }

    if (players.p1.native !== zeroAddress.native && players.p2.native !== zeroAddress.native) {
      const key1 = super.getPlayerKey(sessionID, players.p1)
      const key2 = super.getPlayerKey(sessionID, players.p2)

      if (this.playerChoice(key1).exists && this.playerChoice(key2).exists) {
        this.determineWinner(sessionID)
      }
    }
  }

  /**
   * Claims victory in case the opponent fails to reveal within the allowed time.
   * Transfers the full session balance to the player who revealed, or calls normal winner calculation if both revealed.
   */
  public claimTimeoutVictory(sessionID: uint64): void {
    assert(!this.gameFinished(sessionID).value, 'Game already finished')
    assert(this.sessionExists(sessionID), 'Session does not exist')

    const config = clone(this.gameSessions(sessionID).value)
    assert(Global.round > config.endRevealAt, 'Reveal phase not yet ended')

    const players = clone(this.sessionPlayers(sessionID).value)
    const zeroAddress = new Address(Global.zeroAddress)

    assert(players.p2.native !== zeroAddress.native, 'Not enough players for timeout logic')

    const key1 = super.getPlayerKey(sessionID, players.p1)
    const key2 = super.getPlayerKey(sessionID, players.p2)

    const p1Revealed = this.playerChoice(key1).exists
    const p2Revealed = this.playerChoice(key2).exists

    const totalPot = this.getSessionBalance(sessionID)

    if (p1Revealed && !p2Revealed) {
      this.distributePrize(players.p1, totalPot)
    } else if (!p1Revealed && p2Revealed) {
      this.distributePrize(players.p2, totalPot)
    } else {
      this.determineWinner(sessionID)
      return
    }
    this.gameFinished(sessionID).value = 1
  }

  /**
   * Determines the winner and distributes the pot.
   * Marks the game as finished.
   */
  private determineWinner(sessionID: uint64): void {
    assert(!this.gameFinished(sessionID).value, 'Prize already distributed')

    const players = clone(this.sessionPlayers(sessionID).value)
    const choice1: uint64 = this.getPlayerChoice(sessionID, players.p1)
    const choice2: uint64 = this.getPlayerChoice(sessionID, players.p2)
    const balance: uint64 = this.getSessionBalance(sessionID)

    const ROCK = 0
    const PAPER = 1
    const SCISSORS = 2

    if (choice1 === choice2) {
      const half: uint64 = balance / 2
      this.distributePrize(players.p1, half)
      this.distributePrize(players.p2, half)
    } else if (
      (choice1 === ROCK && choice2 === SCISSORS) ||
      (choice1 === PAPER && choice2 === ROCK) ||
      (choice1 === SCISSORS && choice2 === PAPER)
    ) {
      this.distributePrize(players.p1, balance)
    } else {
      this.distributePrize(players.p2, balance)
    }

    this.gameFinished(sessionID).value = 1
  }

  /**
   * Sends a prize to a player via Inner Transaction.
   */
  private distributePrize(winner: Address, amount: uint64): void {
    itxn
      .payment({
        receiver: winner.native,
        amount,
        fee: 0,
      })
      .submit()
  }

  /**
   * Calculates the MBR required for this game type.
   * Includes storage for player slots and game status boxes.
   */
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      const playersMBR: uint64 = super.getBoxMBR(11, 64)
      const stateMBR: uint64 = super.getBoxMBR(11, 8)

      return playersMBR + stateMBR + super.getRequiredMBR('newGame')
    } else if (command === 'join') {
      return super.getRequiredMBR('join')
    } else {
      assert(false, 'Command not supported')
    }
  }
}
