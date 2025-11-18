import {
  assert,
  BoxMap,
  clone,
  Contract,
  Global,
  GlobalState,
  gtxn,
  itxn,
  op,
  Txn,
  Uint64,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { Address, Bool, StaticArray, StaticBytes } from '@algorandfoundation/algorand-typescript/arc4'
import { bzero } from '@algorandfoundation/algorand-typescript/op'
import type { GameState } from './gameState.algo'

/**
 * Abstract contract for managing multiplayer games on Algorand.
 * Provides the basic logic for creating, joining, committing/revealing moves,
 * managing fees, and deleting games.
 *
 * This class is intended to be extended by concrete contracts that implement
 * the specific game logic. It should not be deployed directly.
 *
 * Subclasses should add specific game methods and logic,
 */
export class AbstractGameContract extends Contract {
  /**Last game id*/
  gameIdCounter = GlobalState<uint64>({ initialValue: 0 })

  /**Storage for games data */
  games = BoxMap<uint64, GameState>({ keyPrefix: 'games' })

  /**
   * Join a game by paying an entry fee
   * @param gameId The ID of the game to join
   * @param payment Payment transaction for joining the game
   */
  public joinGame(gameId: uint64, payment: gtxn.PaymentTxn): void {
    // Verify the game exists
    assert(this.games(gameId).exists, 'Game does not exist')
    const game = clone(this.games(gameId).value)
    // Check if game is not full
    assert(game.currentPlayerCount < game.maxPlayers, 'Game is full')
    // Verify payment is sent to the contract
    assert(payment.receiver === Global.currentApplicationAddress, 'Payment must be to the contract')
    //Verify the amount is sufficent for the game
    assert(payment.amount === game.participationFee, 'Payment amount must match the participation fee')
    // Check player is not already in the game
    let alreadyJoined = false
    for (let i: uint64 = 0; i < game.currentPlayerCount; i = i + 1) {
      if (game.players[i].native === Txn.sender) {
        alreadyJoined = true
        break
      }
    }
    assert(!alreadyJoined, 'Player already joined')

    // Add player to the game
    game.players[game.currentPlayerCount] = new Address(Txn.sender)
    game.commits[game.currentPlayerCount] = new StaticBytes<32>(bzero(32))
    game.moves[game.currentPlayerCount] = new StaticBytes<32>(bzero(32))
    game.hasRevealed[game.currentPlayerCount] = new Bool(false)
    game.hasCommitted[game.currentPlayerCount] = new Bool(false)

    game.currentPlayerCount += 1
    game.balance = Uint64(game.balance + payment.amount)
    //If the last player joined, start the commit timer
    if (game.currentPlayerCount === game.maxPlayers) game.deadline = Global.latestTimestamp + game.timerCommit
    // Update the game state in storage
    this.games(gameId).value = clone(game)
  }

  /**
   * Public method to get the required MBR to create a game
   * @returns Required MBR in microAlgos
   */
  public getRequiredMbr(): uint64 {
    return 630900
  }

  /**
   * Creates a new game and adds the creator as the first player
   * Marked as protected so the concrete contract can have a public createGame method
   * and set some parameters by default if it doesn't want the creator to choose them.
   * @param maxPlayers Maximum number of players must at least 2
   * @param entryFee Participation fee in microAlgos
   * @param mbr Payment transaction to cover the box MBR
   * @param entryPayment Payment transaction for the creator's participation fee
   * @param timerCommit Timer in seconds for the commit phase
   * @param timerReveal Timer in seconds for the reveal phase
   * @returns The ID of the newly created game
   */
  protected createGame(
    maxPlayers: uint64,
    entryFee: uint64,
    mbr: gtxn.PaymentTxn,
    entryPayment: gtxn.PaymentTxn,
    timerCommit: uint64,
    timerReveal: uint64,
  ): uint64 {
    // Validate the number of players
    assert(maxPlayers >= 2 && maxPlayers <= 15, 'Player number must be beetween 2-15')

    // Validate entryFee
    assert(entryFee > 0 && entryFee <= 500_000_000, 'Participation fee must be beetween 1 - 500000000')

    // Validate timerCommit
    assert(timerCommit >= 300 && timerCommit <= 604800, 'Commit timer must be beetween 5 minutes and 7 days')

    // Validate timerReveal
    assert(timerReveal >= 300 && timerReveal <= 604800, 'Reveal timer must be beetween 5 minutes and 7 days')

    // Verify the MBR payment
    assert(mbr.receiver === Global.currentApplicationAddress, 'MBR payment must be to the contract')
    assert(mbr.amount >= this.getRequiredMbr(), 'Insufficient MBR')

    // Verify the entry fee payment - This check is also in joinGame
    assert(entryPayment.receiver === Global.currentApplicationAddress, 'Entry fee payment must be to the contract')
    assert(entryPayment.amount === entryFee, 'Payment amount must be the entry fee')

    this.gameIdCounter.value = this.gameIdCounter.value + 1

    const newGame: GameState = {
      players: new StaticArray<Address, 15>(),
      currentPlayerCount: 0,
      maxPlayers: maxPlayers,
      commits: new StaticArray<StaticBytes<32>, 15>(),
      hasCommitted: new StaticArray<Bool, 15>(),
      hasRevealed: new StaticArray<Bool, 15>(),
      moves: new StaticArray<StaticBytes<32>, 15>(),
      balance: 0,
      participationFee: entryFee,
      deadline: 0,
      timerCommit: timerCommit,
      timerReveal: timerReveal,
      winner: new Address(),
    }

    this.games(this.gameIdCounter.value).value = clone(newGame)

    // The creator automatically joins the newly created game
    this.joinGame(this.gameIdCounter.value, entryPayment)

    return this.gameIdCounter.value
  }

  /**
   * Registers a player's commit (hash of move + salt)
   * @param gameId The ID of the game
   * @param commitment The commit hash (hash(move + salt))
   */
  public commit(gameId: uint64, commitment: StaticBytes<32>): void {
    // Verify the game exists
    assert(this.games(gameId).exists, 'Game does not exist')

    const game = clone(this.games(gameId).value)

    // Find the player's index
    let playerIndex: uint64 = game.maxPlayers // Impossible value as default
    for (let i: uint64 = 0; i < game.currentPlayerCount; i = i + 1) {
      if (game.players[i].native === Txn.sender) {
        playerIndex = i
        break
      }
    }

    // Verify the caller is a player in the game
    assert(playerIndex < game.maxPlayers, 'You are not a player in this game')

    // Verify the game is full (all players have joined, and the game has started)
    assert(game.currentPlayerCount === game.maxPlayers, 'The game is not full yet')

    // Verify the player has not already committed. Moves cannot be overwritten.
    assert(!game.hasCommitted[playerIndex].native, 'You have already committed')

    // Register the commit
    game.commits[playerIndex] = commitment
    game.hasCommitted[playerIndex] = new Bool(true)

    let allCommitted = true
    for (const b of game.hasCommitted) {
      if (!b.native) {
        allCommitted = false
        break
      }
    }

    if (allCommitted) {
      game.deadline = Global.latestTimestamp + game.timerReveal
    }

    // Update the game state
    this.games(gameId).value = clone(game)
  }

  /**
   * Allows a player to reveal their move.
   * @param gameId The ID of the game
   * @param move The move in plaintext
   * @param salt The salt used in the commit
   */
  public reveal(gameId: uint64, move: StaticBytes<32>, salt: uint64): void {
    // Verify the game exists
    assert(this.games(gameId).exists, 'Game does not exist')

    // Check move size limit
    assert(move.native.length <= 32, 'Move exceeds maximum allowed size')

    const game = clone(this.games(gameId).value)

    // Find the player's index
    let playerIndex: uint64 = game.maxPlayers
    for (let i: uint64 = 0; i < game.currentPlayerCount; i = i + 1) {
      if (game.players[i].native === Txn.sender) {
        playerIndex = i
        break
      }
    }
    assert(playerIndex < game.maxPlayers, 'You are not a player in this game')

    // Verify the player has committed
    assert(game.hasCommitted[playerIndex].native, 'You have not committed')

    // Check if the commit phase is actually over
    let allCommitted = true
    for (const b of game.hasCommitted) {
      if (!b.native) {
        allCommitted = false
        break
      }
    }
    assert(allCommitted, 'Cannot reveal: not all players have committed yet')

    // Verify the player has not already revealed
    assert(!game.hasRevealed[playerIndex].native, 'You have already revealed')

    // Calculate the hash of the move and salt
    const computedHash = op.sha256(move.native.concat(op.itob(salt)))

    // Compare with the saved commit
    assert(computedHash === game.commits[playerIndex].native, 'Commitment does not match')

    // Save the move and mark as revealed
    game.moves[playerIndex] = move
    game.hasRevealed[playerIndex] = new Bool(true)

    // Check if all players have now revealed
    let allRevealed = true
    for (const b of game.hasRevealed) {
      if (!b.native) {
        allRevealed = false
        break
      }
    }

    if (allRevealed) {
      game.deadline = 0
      this.chooseWinner(game)
    }

    // Update the game state
    this.games(gameId).value = clone(game)
  }

  /**
   * Allows a player to withdraw from a game before it starts.
   * @param gameId The ID of the game to withdraw from.
   */
  public backOff(gameId: uint64): void {
    // Verify the game exists
    assert(this.games(gameId).exists, 'Game does not exist')
    const game = clone(this.games(gameId).value)

    // Find the player's index
    let playerIndex: uint64 = game.maxPlayers
    for (let i: uint64 = 0; i < game.currentPlayerCount; i = i + 1) {
      if (game.players[i].native === Txn.sender) {
        playerIndex = i
        break
      }
    }
    assert(playerIndex < game.maxPlayers, 'You are not a player in this game')

    // Verify the game has not started yet
    assert(game.currentPlayerCount < game.maxPlayers, 'You cannot withdraw after the game has started')

    // Refund the participationFee to the player
    itxn
      .payment({
        receiver: Txn.sender,
        amount: game.participationFee,
      })
      .submit()

    game.players[playerIndex] = game.players[game.currentPlayerCount]
    game.commits[playerIndex] = game.commits[game.currentPlayerCount]
    game.hasCommitted[playerIndex] = game.hasCommitted[game.currentPlayerCount]
    game.hasRevealed[playerIndex] = game.hasRevealed[game.currentPlayerCount]
    game.moves[playerIndex] = game.moves[game.currentPlayerCount]

    // Update player count and balance
    game.currentPlayerCount -= 1
    game.balance -= game.participationFee

    // Save the updated state
    this.games(gameId).value = clone(game)
  }

  /**
   * Verifies the game state against the deadline and resolves the game if the deadline has passed.
   * This function handles timeouts for both commit and reveal phases.
   * @param gameId The ID of the game to check.
   */
  public verifyDeadline(gameId: uint64): void {
    assert(this.games(gameId).exists, 'Game does not exist')
    const game = clone(this.games(gameId).value)
    const preDelBox = op.minBalance(Global.currentApplicationAddress)

    // If deadline is 0, no timer is active. Do nothing.
    if (game.deadline === 0) return

    // Compare with the current timestamp
    assert(Global.latestTimestamp >= game.deadline, 'The deadline has not been reached yet')

    // Check if we are in the commit phase (not all players have committed)
    let allCommitted = true
    for (const b of game.hasCommitted) {
      if (!b.native) {
        allCommitted = false
        break
      }
    }

    // Count how many players have revealed
    let revealedCount: uint64 = 0
    for (const b of game.hasRevealed) {
      if (b.native) revealedCount = revealedCount + 1
    }

    // Scenario 1: Commit phase timed out OR Reveal phase timed out with 0 reveals
    if (!allCommitted || revealedCount === 0) {
      // Refund only those who committed
      for (let i: uint64 = 0; i < game.hasCommitted.length; i = i + 1) {
        if (game.hasCommitted[i].native) {
          itxn
            .payment({
              receiver: game.players[i].native,
              amount: game.participationFee,
              fee: 0, // Fee is covered by the outer transaction group
            })
            .submit()
        }
      }

      // Delete the game box
      this.games(gameId).delete()

      // Calculate MBR after deletion
      const postDelBox = op.minBalance(Global.currentApplicationAddress)

      // Return the MBR to the creator
      const mbrToReturn: uint64 = preDelBox - postDelBox
      itxn
        .payment({
          receiver: game.players[0].native,
          amount: mbrToReturn,
          fee: 0, // Fee is covered by the outer transaction group
        })
        .submit()
      return // Exit function
    }

    // Scenario 2: Reveal phase timed out, but at least 1 person revealed
    const share: uint64 = game.balance / revealedCount
    const remainder: uint64 = game.balance % revealedCount // Handle "dust"

    for (let i: uint64 = 0; i < game.hasRevealed.length; i = i + 1) {
      if (game.hasRevealed[i].native) {
        itxn
          .payment({
            receiver: game.players[i].native,
            amount: share,
            fee: 0, // Fee is covered by the outer transaction group
          })
          .submit()
      }
    }

    // Delete the game box
    this.games(gameId).delete()

    // Calculate MBR after deletion
    const postDelBox = op.minBalance(Global.currentApplicationAddress)

    // Return the MBR to the creator
    const mbrToReturn: uint64 = preDelBox - postDelBox

    // Return MBR and any leftover "dust" to the creator
    itxn
      .payment({
        receiver: game.players[0].native,
        amount: mbrToReturn + remainder,
        fee: 0,
      })
      .submit()
  }

  /**
   * Abstract method: MUST be implemented in the concrete subclass.
   * Must evaluate moves and choose the winner.
   * It is called by reveal() after all moves are revealed.
   */
  protected chooseWinner(game: GameState): void {}

  /**
   * Deletes a game and refunds all players
   * Only the creator (player[0]) can delete the game
   * @param gameId The ID of the game to delete
   */
  public deleteGame(gameId: uint64): void {
    // Verify the game exists
    assert(this.games(gameId).exists, 'Game does not exist')

    const game = clone(this.games(gameId).value)

    // Verify the caller is the creator (first player)
    assert(Txn.sender === game.players[0].native, 'Only the creator can delete the game')
    // Verify the game has not started
    assert(game.currentPlayerCount < game.maxPlayers, 'Game has started, deletion not possible')

    // Refund all players (entry fee)
    for (let i: uint64 = 0; i < game.currentPlayerCount; i = i + 1) {
      itxn
        .payment({
          receiver: game.players[i].native,
          amount: game.participationFee,
          fee: 0,
        })
        .submit()
    }
    // Calculate MBR before deleting the box
    const preDelBox = op.minBalance(Global.currentApplicationAddress)

    this.games(gameId).delete()

    // Calculate MBR after deletion
    const postDelBox = op.minBalance(Global.currentApplicationAddress)

    // Return the MBR to the creator
    const mbrToReturn: uint64 = preDelBox - postDelBox
    itxn
      .payment({
        receiver: game.players[0].native,
        amount: mbrToReturn,
        fee: 0,
      })
      .submit()
  }

  public getGameInfo(gameId: uint64): GameState {
    assert(this.games(gameId).exists, 'Game does not exist')
    return this.games(gameId).value
  }
}
