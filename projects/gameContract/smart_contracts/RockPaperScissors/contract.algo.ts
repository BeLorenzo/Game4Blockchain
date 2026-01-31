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

    return sessionID
  }

  /**
   * Allows a player to join the session, assigning them to an empty slot.
   * Enforces a maximum of 2 players per session.
   */
  public joinSession(sessionID: uint64, commit: bytes, payment: gtxn.PaymentTxn, mbrPayment: gtxn.PaymentTxn): void {
    assert(this.sessionExists(sessionID), 'Session does not exist')

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

    super.reveal(sessionID, choice, salt)
  }
    
  /**
   * Allows an eligible player to claim their winnings.
   * Uses a pull-based payout pattern.
   */
public claimWinnings(sessionID: uint64): uint64 {
  assert(this.sessionExists(sessionID), 'Session does not exist')

  const config = clone(this.gameSessions(sessionID).value)
  assert(Global.round > config.endRevealAt, "Game is not finished")

  const sender = new Address(Txn.sender)
  
  const playerKey = this.getPlayerKey(sessionID, sender)
  assert(this.playerChoice(playerKey).exists, 'Player has not revealed or already claimed')
  
  let myChoice = this.playerChoice(playerKey).value
  assert(myChoice <= 2, "Winnings already claimed")

  const players = clone(this.sessionPlayers(sessionID).value)

  const oppKey = this.getPlayerKey(
    sessionID,
    sender.native === players.p1.native ? players.p2 : players.p1
  )

  const oppHasChoice = this.playerChoice(oppKey).exists
  let oppChoice: uint64 = 4
  let oppClaimed = false

  if (oppHasChoice) {
    const rawOppChoice = this.playerChoice(oppKey).value
    if (rawOppChoice >= 10) {
        oppChoice = rawOppChoice - 10
        oppClaimed = true
      } else {
        oppChoice = rawOppChoice
      }
  }

  const currentBalance = this.getSessionBalance(sessionID)

  if (oppChoice === 4) {
        this.payAndClean(sender, currentBalance, playerKey)
        return currentBalance
    }
  
  const isDraw = (myChoice === oppChoice)
  const prizeAmount = this.calculateLogic(myChoice, oppChoice, currentBalance)
  
  if (prizeAmount > 0) {
        
        // Se è un pareggio e l'avversario ha già riscattato, 
        // il "prizeAmount" calcolato su currentBalance (che è dimezzato) è corretto?
        // Se lui ha riscattato, ha lasciato lì la mia metà. Quindi prendo TUTTO quello che resta.
        const finalPayout = (isDraw && oppClaimed) ? currentBalance : prizeAmount

        // Eseguiamo il pagamento
        itxn.payment({
          receiver: sender.native,
          amount: finalPayout,
          fee: 0,
        }).submit()
    } else {
       // Ho perso. Non ricevo nulla.
    }

  if (oppClaimed || oppChoice === 4) {
        // Siamo gli ultimi a uscire, spegni la luce (Delete both boxes)
        this.playerChoice(playerKey).delete()
        if (oppHasChoice) this.playerChoice(oppKey).delete()
    } else {
        // L'avversario deve ancora verificare il risultato, lascio la mia scelta visibile ma marcata
        this.playerChoice(playerKey).value = myChoice + 10
    }

    return prizeAmount
  }

  private payAndClean(receiver: Address, amount: uint64, keyToDelete: bytes): void {
      itxn.payment({
        receiver: receiver.native,
        amount: amount,
        fee: 0,
      }).submit()
      this.playerChoice(keyToDelete).delete()
  }

  /**
   * Helper to determine RPS result and return the payout amount for the caller.
   */
private calculateLogic(
  choice1: uint64,
  choice2: uint64,
  totalPot: uint64
): uint64 {

  const ROCK = 0
  const PAPER = 1
  const SCISSORS = 2

  if (choice1 === choice2) {
    return totalPot / 2
  }

  const p1Wins =
    (choice1 === ROCK && choice2 === SCISSORS) ||
    (choice1 === PAPER && choice2 === ROCK) ||
    (choice1 === SCISSORS && choice2 === PAPER)

  return (p1Wins) ? totalPot : 0
}

  /**
   * Calculates the MBR required for this game type.
   * Includes storage for player slots and game status boxes.
   */
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    if (command === 'newGame') {
      const playersMBR: uint64 = super.getBoxMBR(11, 64)

      return playersMBR + super.getRequiredMBR('newGame')
    } else if (command === 'join') {
      return super.getRequiredMBR('join')
    } else {
      assert(false, 'Command not supported')
    }
  }
}
