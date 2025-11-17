import { TransactionType, uint64 } from '@algorandfoundation/algorand-typescript'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it } from 'vitest'
import { ProvaConcreteContract } from './contract.algo'

describe('GameContract', () => {
  const context = new TestExecutionContext()

  it('Creates a new game', () => {
    // Arrange
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = context.any.uint64(2, 50)
    const entryFee = 100000
    const mbr = contract.getRequiredMbr(maxPlayers)
    const mbrPayment = context.any.txn.payment({
      receiver: app.address,
      amount: mbr,
    })
    const entryPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    const timerCommit = context.any.uint64(1, 604800)
    const timerReveal = context.any.uint64(1, 604800)

    // Act
    const gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)

    const game = contract.games(gameId).value

    // Assert
    expect(gameId.valueOf()).toBeGreaterThan(0)
    expect(game.balance === entryFee)
    expect(game.players.length === 1)
    expect(game.currentPlayerCount === 1)
    expect(game.hasRevealed[0].native === false)
    expect(game.players[0].native).toEqual(context.defaultSender)
  })

  it('Allows a player to join a game', () => {
    // Arrange
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = context.any.uint64(5, 10)
    const entryFee = context.any.uint64(1, 100000)
    const mbr = contract.getRequiredMbr(maxPlayers)
    const mbrPayment = context.any.txn.payment({
      receiver: app.address,
      amount: mbr,
    })
    const entryPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    const timerCommit = context.any.uint64(1, 604800)
    const timerReveal = context.any.uint64(1, 604800)

    // Crea il gioco
    const gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)

    // Simula un nuovo account per il join
    const joiningAccount = context.any.account()
    const joinPayment = context.any.txn.payment({
      sender: joiningAccount,
      receiver: app.address,
      amount: entryFee,
    })

    // Act
    context.txn.createScope([context.any.txn.applicationCall({ sender: joiningAccount, appId: app })]).execute(() => {
      contract.joinGame(gameId, joinPayment)
    })

    const secondJoiner = context.any.account()
    const secondJoinPayment = context.any.txn.payment({
      sender: secondJoiner,
      receiver: app.address,
      amount: entryFee,
    })

    context.txn.createScope([context.any.txn.applicationCall({ sender: secondJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, secondJoinPayment)
    })

    // Assert
    const game = contract.games(gameId).value
    expect(gameId.valueOf()).toBeGreaterThanOrEqual(1)
    expect(game.balance === entryFee * 3)
    expect(game.players.length === 3)
    expect(game.currentPlayerCount === 3)
    expect(game.hasRevealed[0].native === false)
    expect(game.players[0].native).toEqual(context.defaultSender)
    expect(game.players[1].native).toEqual(joiningAccount)
  })

  it('should throw if the game does not exist', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const fakeGameId = context.any.uint64(1000, 2000)
    const payment = context.any.txn.payment({
      receiver: context.any.account(),
      amount: context.any.uint64(1),
    })
    expect(() => contract.joinGame(fakeGameId, payment)).toThrow('Game does not exist')
  })

  it('should throw if the game is full', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 2
    const mbr = contract.getRequiredMbr(maxPlayers)
    const entryFee = context.any.uint64(1, 100000)
    const mbrPayment = context.any.txn.payment({ receiver: app.address, amount: mbr })
    const entryPayment = context.any.txn.payment({ receiver: app.address, amount: entryFee })
    const timerCommit = context.any.uint64(1, 604800)
    const timerReveal = context.any.uint64(1, 604800)
    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })

    const firstJoiner = context.any.account()
    const firstJoinPayment = context.any.txn.payment({
      sender: firstJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: firstJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, firstJoinPayment)
    })

    const secondJoiner = context.any.account()
    const secondJoinPayment = context.any.txn.payment({
      sender: secondJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    expect(() => {
      context.txn.createScope([context.any.txn.applicationCall({ sender: secondJoiner, appId: app })]).execute(() => {
        contract.joinGame(gameId, secondJoinPayment)
      })
    }).toThrow('Game is full')
  })

  it('should throw if payment is not to the contract', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 2
    const entryFee = 100000
    const mbrPayment = context.any.txn.payment({ receiver: app.address, amount: context.any.uint64(100_000) })
    const entryPayment = context.any.txn.payment({ receiver: app.address, amount: entryFee })
    const timerCommit = context.any.uint64(1, 604800)
    const timerReveal = context.any.uint64(1, 604800)
    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })
    // Pagamento verso un altro account
    const wrongReceiver = context.any.account()
    const joinPayment = context.any.txn.payment({
      receiver: wrongReceiver,
      amount: entryFee,
    })
    expect(() => contract.joinGame(gameId, joinPayment)).toThrow('Payment must be to the contract')
  })

  it('should throw if payment amount does not match participation fee', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 2
    const entryFee = 100000
    const mbrPayment = context.any.txn.payment({ receiver: app.address, amount: context.any.uint64(100_000) })
    const entryPayment = context.any.txn.payment({ receiver: app.address, amount: entryFee })
    const timerCommit = context.any.uint64(1, 604800)
    const timerReveal = context.any.uint64(1, 604800)
    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })
    // Pagamento con importo sbagliato
    const joinPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee + 1,
    })
    expect(() => contract.joinGame(gameId, joinPayment)).toThrow('Payment amount must match the participation fee')
  })

  it('should throw if player already joined', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 2
    const entryFee = 100000
    const mbrPayment = context.any.txn.payment({ receiver: app.address, amount: context.any.uint64(100_000) })
    const entryPayment = context.any.txn.payment({ receiver: app.address, amount: entryFee })
    const timerCommit = context.any.uint64(1, 604800)
    const timerReveal = context.any.uint64(1, 604800)
    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })
    // Prova a joinare di nuovo con lo stesso account
    const joinPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    expect(() => contract.joinGame(gameId, joinPayment)).toThrow('Player already joined')
  })

  it('should throw error if number of player is insufficent', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 1
    const entryFee = 100000
    const mbrPayment = context.any.txn.payment({ receiver: app.address, amount: context.any.uint64(100_000) })
    const entryPayment = context.any.txn.payment({ receiver: app.address, amount: entryFee })
    const timerCommit = context.any.uint64(1, 604800)
    const timerReveal = context.any.uint64(1, 604800)
    expect(() =>
      contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal),
    ).toThrow('At least 2 players are required')
  })

  it('should throw error if commit timer is too short', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 5
    const entryFee = 100000
    const mbrPayment = context.any.txn.payment({ receiver: app.address, amount: context.any.uint64(100_000) })
    const entryPayment = context.any.txn.payment({ receiver: app.address, amount: entryFee })
    const timerCommit = context.any.uint64(2, 299)
    const timerReveal = context.any.uint64(300, 604800)
    expect(() =>
      contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal),
    ).toThrow('Commit timer must be greater than 5 minutes')
  })

  it('should throw error if reveal timer is too long', () => {
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 5
    const entryFee = 100000
    const mbrPayment = context.any.txn.payment({ receiver: app.address, amount: context.any.uint64(100_000) })
    const entryPayment = context.any.txn.payment({ receiver: app.address, amount: entryFee })
    const timerCommit = context.any.uint64(300, 604800)
    const timerReveal = context.any.uint64(604800)
    expect(() =>
      contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal),
    ).toThrow('Reveal timer cannot exceed 7 days')
  })

  it('The creator can delete the game', () => {
    // Arrange
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = context.any.uint64(2, 50)
    const entryFee = 100000
    const mbr = contract.getRequiredMbr(maxPlayers)
    const mbrPayment = context.any.txn.payment({
      receiver: app.address,
      amount: mbr,
    })
    const entryPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    const timerCommit = context.any.uint64(300, 604800)
    const timerReveal = context.any.uint64(300, 604800)

    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
      contract.deleteGame(gameId)
      expect(contract.games(gameId).exists).toBeFalsy
    })
  })

  it('The creator can delete the game even with some partecipants', () => {
    // Arrange
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 5
    const entryFee = 1000000
    const mbr = contract.getRequiredMbr(maxPlayers)
    const mbrPayment = context.any.txn.payment({
      receiver: app.address,
      amount: mbr,
    })
    const entryPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    const timerCommit = context.any.uint64(300, 604800)
    const timerReveal = context.any.uint64(300, 604800)

    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })

    const firstJoiner = context.any.account()
    const firstJoinPayment = context.any.txn.payment({
      sender: firstJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: firstJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, firstJoinPayment)
    })

    const secondJoiner = context.any.account()
    const secondJoinPayment = context.any.txn.payment({
      sender: secondJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: secondJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, secondJoinPayment)
    })

    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      contract.deleteGame(gameId)
      expect(!contract.games(gameId).exists)
    })
  })

  it('The creator cannot delete the game if it is full', () => {
    // Arrange
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 3
    const entryFee = 1000000
    const mbr = contract.getRequiredMbr(maxPlayers)
    const mbrPayment = context.any.txn.payment({
      receiver: app.address,
      amount: mbr,
    })
    const entryPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    const timerCommit = context.any.uint64(300, 604800)
    const timerReveal = context.any.uint64(300, 604800)

    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })

    const firstJoiner = context.any.account()
    const firstJoinPayment = context.any.txn.payment({
      sender: firstJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: firstJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, firstJoinPayment)
    })

    const secondJoiner = context.any.account()
    const secondJoinPayment = context.any.txn.payment({
      sender: secondJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: secondJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, secondJoinPayment)
    })

    expect(() =>
      context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
        contract.deleteGame(gameId)
      }),
    ).toThrowError('Game has started, deletion not possible')
  })

  it('Only the creator can delete the game', () => {
    // Arrange
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 3
    const entryFee = 1000000
    const mbr = contract.getRequiredMbr(maxPlayers)
    const mbrPayment = context.any.txn.payment({
      receiver: app.address,
      amount: mbr,
    })
    const entryPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    const timerCommit = context.any.uint64(300, 604800)
    const timerReveal = context.any.uint64(300, 604800)

    let gameId: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })

    const firstJoiner = context.any.account()
    const firstJoinPayment = context.any.txn.payment({
      sender: firstJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: firstJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, firstJoinPayment)
    })

    const secondJoiner = context.any.account()
    const secondJoinPayment = context.any.txn.payment({
      sender: secondJoiner,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: secondJoiner, appId: app })]).execute(() => {
      contract.joinGame(gameId, secondJoinPayment)
    })

    expect(() =>
      context.txn.createScope([context.any.txn.applicationCall({ appId: app, sender: secondJoiner })]).execute(() => {
        contract.deleteGame(gameId)
      }),
    ).toThrowError('Only the creator can delete the game')
  })

  it('allows a player to back off before the game starts', () => {
    // Arrange
    const contract = context.contract.create(ProvaConcreteContract)
    const app = context.ledger.getApplicationForContract(contract)
    const maxPlayers = 5
    const entryFee = 100000
    const mbr = contract.getRequiredMbr(maxPlayers)
    const mbrPayment = context.any.txn.payment({
      receiver: app.address,
      amount: mbr,
    })
    const entryPayment = context.any.txn.payment({
      receiver: app.address,
      amount: entryFee,
    })
    const timerCommit = context.any.uint64(300, 604800)
    const timerReveal = context.any.uint64(300, 604800)

    // Crea il gioco
    let gameId: uint64
    let oldPlayerCount: uint64
    let oldBalance: uint64
    context.txn.createScope([context.any.txn.applicationCall({ appId: app })]).execute(() => {
      gameId = contract.createNewGame(maxPlayers, entryFee, mbrPayment, entryPayment, timerCommit, timerReveal)
    })

    // Un nuovo giocatore si unisce
    const player = context.any.account()
    const joinPayment = context.any.txn.payment({
      sender: player,
      receiver: app.address,
      amount: entryFee,
    })
    context.txn.createScope([context.any.txn.applicationCall({ sender: player, appId: app })]).execute(() => {
      contract.joinGame(gameId, joinPayment)
      oldPlayerCount = contract.games(gameId).value.currentPlayerCount
      oldBalance = contract.games(gameId).value.balance
    })

    // Act: il giocatore fa backOff
    context.txn.createScope([context.any.txn.applicationCall({ sender: player, appId: app })]).execute(() => {
      contract.backOff(gameId)

      // Verifica che la partecipationFee sia stata rimborsata tramite inner transaction
      const itxnGroup = context.txn.lastGroup.lastItxnGroup()
      let found = false
      for (const itxn of itxnGroup.itxns) {
        if (itxn.type === TransactionType.Payment && itxn.receiver === player && itxn.amount === entryFee) {
          found = true
          break
        }
      }
      expect(found).toBe(true)

      // Verifica che il giocatore sia stato rimosso e il balance aggiornato
      const game = contract.games(gameId).value
      expect(game.currentPlayerCount).toBe(oldPlayerCount - 1)
      expect(game.balance).toBe(oldBalance - entryFee)
      found = false
      for (let i = 0; i < game.players.length; i + 1) {
        if (game.players.at(i).native === player) {
          found = true
          break
        }
      }
      expect(found).toBe(false)
    })
  })
})
