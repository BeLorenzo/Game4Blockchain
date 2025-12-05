import type { bytes, uint64 } from '@algorandfoundation/algorand-typescript'
import { assert, BoxMap, clone, Global, gtxn, itxn, Txn, Uint64 } from '@algorandfoundation/algorand-typescript'
import { Address } from '@algorandfoundation/algorand-typescript/arc4'
import { GameConfig, GameContract } from '../abstract_contract/contract.algo'

/**
 * Tracks the two players participating in a specific session.
 */
interface SessionPlayers {
  p1: Address
  p2: Address
}

/**
 * Concrete implementation of Rock-Paper-Scissors.
 * Extends the abstract GameContract to handle the specific 2-player logic and win conditions.
 */
export class RockPaperScissors extends GameContract {
  /**
   * Maps SessionID to the two player addresses.
   * Key: Prefix 'spl' + SessionID
   */
  sessionPlayers = BoxMap<uint64, SessionPlayers>({ keyPrefix: 'spl' })

  /**
   * Status flag to prevent double payouts.
   * Key: Prefix 'gfn' + SessionID
   * Value: 0 (Active) | 1 (Finished)
   */
  gameFinished = BoxMap<uint64, uint64>({ keyPrefix: 'gfn' })

  /**
   * Initializes a new RPS session.
   * Calculates the extended MBR required for storing player slots and game status.
   *
   * @param config - Game configuration (timelines and fee).
   * @param mbrPayment - Payment transaction to cover MBR.
   */
  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    const totalMBR: uint64 = this.getRequiredMBR('newGame')

    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment must be sent to contract')
    assert(mbrPayment.amount === totalMBR, 'Payment must cover exact MBR for session data')

    // Delegate basic session creation to parent
    const sessionID = super.create(config)

    // Initialize local storage
    const zeroAddress = Global.zeroAddress
    this.sessionPlayers(sessionID).value = {
      p1: new Address(zeroAddress),
      p2: new Address(zeroAddress),
    }
    this.gameFinished(sessionID).value = 0

    return sessionID
  }

  /**
   * Joins the session, assigning the player to an empty slot (P1 or P2).
   * Enforces a maximum of 2 players per session.
   *
   * @param sessionID - The ID of the session i want to partecipate
   * @param commit - The has of myChoice + salt
   * @param payment - The payment needed to partecipate
   * @param mbrPayment - The payment for the needed space
   */
  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn, mbrPayment: gtxn.PaymentTxn): void {
    assert(this.sessionExists(sessionID), 'Session does not exist')
    assert(!this.gameFinished(sessionID).value, "Game is over")

    const players = clone(this.sessionPlayers(sessionID).value)
    const senderAddress = new Address(Txn.sender)
    const zeroAddress = new Address(Global.zeroAddress)

    assert(
      players.p1.native !== senderAddress.native && players.p2.native !== senderAddress.native,
      'Player already joined this session',
    )

    // Verify MBR for player data storage
    const requiredMBR: uint64 = this.getRequiredMBR('join')
    assert(mbrPayment.receiver === Global.currentApplicationAddress, 'MBR payment receiver must be contract')
    assert(mbrPayment.amount === requiredMBR, 'Insufficient MBR payment for player storage')

    // Assign slot
    if (players.p1.native === zeroAddress.native) {
      players.p1 = senderAddress
    } else if (players.p2.native === zeroAddress.native) {
      players.p2 = senderAddress
    } else {
      assert(false, 'Session is full (Max 2 players)')
    }
    super.join(sessionID, commit, payment)

    // Update player slots
    this.sessionPlayers(sessionID).value = clone(players)
  }

  /**
   * Reveals a move. If both players have revealed, immediately triggers winner determination.
   *
   * @param sessionID - The ID of the session
   * @param choice - 0 (Rock), 1 (Paper), 2 (Scissors).
   * @param salt - The salt used for the secret commit
   */
  public revealMove(sessionID: uint64, choice: uint64, salt: bytes): void {
    assert(choice < Uint64(3), 'Invalid choice: must be 0, 1, or 2')
    assert(!this.gameFinished(sessionID).value, "Game is over")

    // Delegate commit verification to parent
    super.reveal(sessionID, choice, salt)

    const players = clone(this.sessionPlayers(sessionID).value)
    const zeroAddress = new Address(Global.zeroAddress)

    if (players.p2.native === zeroAddress.native) {
      this.distributePrize(new Address(Txn.sender), this.getSessionBalance(sessionID))
      this.gameFinished(sessionID).value = 1
      return
    }

    // Check if both slots are filled (game actually started)
    if (players.p1.native !== zeroAddress.native && players.p2.native !== zeroAddress.native) {
      const key1 = super.getPlayerKey(sessionID, players.p1)
      const key2 = super.getPlayerKey(sessionID, players.p2)

      // If both players have successfully revealed (Choice boxes exist), end the game
      if (this.playerChoice(key1).exists && this.playerChoice(key2).exists) {
        this.determineWinner(sessionID)
      }
    }
  }

/**
   * Claims victory by default (Timeout) when an opponent fails to reveal their move.
   *
   * This method can ONLY be executed after the Reveal Phase has officially ended
   * (current round > config.endRevealAt). It resolves the stalemate by:
   *
   * 1. Verifying that the deadline has passed.
   * 2. Checking which player successfully revealed their move.
   * 3. Transferring the entire session balance to the single player who revealed.
   *
   * If both players revealed, it falls back to standard winner determination.
   *
   * @param sessionID - The unique identifier of the game session.
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
   * Core logic to determine the winner and distribute the pot.
   * Marks the session as finished to prevent re-entrancy/double spending.
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

    // Draw
    if (choice1 === choice2) {
      const half: uint64 = balance / 2
      this.distributePrize(players.p1, half)
      this.distributePrize(players.p2, half)
    }
    // P1 Wins
    else if (
      (choice1 === ROCK && choice2 === SCISSORS) ||
      (choice1 === PAPER && choice2 === ROCK) ||
      (choice1 === SCISSORS && choice2 === PAPER)
    ) {
      this.distributePrize(players.p1, balance)
    }
    // P2 Wins
    else {
      this.distributePrize(players.p2, balance)
    }

    // Mark game as finished
    this.gameFinished(sessionID).value = 1
  }

  /**
   * Helper to send Algorand via Inner Transaction.
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
   * Calculates the MBR requirements for this specific game type.
   * Adds the cost of 'sessionPlayers' and 'gameFinished' boxes to the parent's requirements.
   */
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      // Box 'spl': KeyPrefix(3) + ID(8) = 11 bytes | Value (32*2) = 64 bytes
      const playersMBR: uint64 = super.getBoxMBR(11, 64)
      // Box 'gfn': KeyPrefix(3) + ID(8) = 11 bytes | Value (uint64) = 8 bytes
      const stateMBR: uint64 = super.getBoxMBR(11, 8)

      return playersMBR + stateMBR + super.getRequiredMBR('newGame')
    } else if (command === 'join') {
      return super.getRequiredMBR('join')
    } else {
      assert(false, 'Command not supported')
    }
  }
}
