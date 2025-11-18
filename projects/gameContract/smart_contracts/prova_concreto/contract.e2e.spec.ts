import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { ProvaConcreteContractFactory } from '../artifacts/prova_concreto/ProvaConcreteContractClient'

describe('GameContract contract', () => {
  const localnet = algorandFixture()
  beforeAll(() => {
    Config.configure({
      debug: true,
    })
    registerDebugEventHandlers()
  })
  beforeEach(localnet.newScope)

  const deploy = async (account: Account & TransactionSignerAccount) => {
    const factory = localnet.algorand.client.getTypedAppFactory(ProvaConcreteContractFactory, {
      defaultSender: account.addr,
      defaultSigner: account.signer,
    })

    const { appClient } = await factory.deploy({ onUpdate: 'append', onSchemaBreak: 'append', suppressLog: true })
    localnet.algorand.account.ensureFunded(appClient.appAddress, account.addr, AlgoAmount.MicroAlgos(200_000))

    return { client: appClient }
  }

  test('creates a new game on localnet', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300

    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })

    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: {
        maxPlayers,
        entryFee,
        mbr: mbrPayment,
        entryPayment,
        timerCommit,
        timerReveal,
      },
      sender: testAccount.addr,
    })

    const gameId = result.return!
    const game = (await client.state.box.games.value(gameId))!

    expect(Number(gameId)).toBeGreaterThan(0)
    expect(Number(game.balance)).toBe(entryFee)
    expect(game.players.length).toBe(15)
    expect(Number(game.currentPlayerCount)).toBe(1)
    expect(game.hasRevealed[0]).toBe(false)
    expect(game.players[0]).toEqual(testAccount.addr.toString())
  })

  test('throws error if maxPlayers is less than 2 or more than 15', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    const mbrPayment2 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment2 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    await expect(
      client.send.createNewGame({
        args: {
          maxPlayers: 1,
          entryFee,
          mbr: mbrPayment,
          entryPayment,
          timerCommit,
          timerReveal,
        },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Player number must be beetween 2-15')

    await expect(
      client.send.createNewGame({
        args: {
          maxPlayers: 100,
          entryFee,
          mbr: mbrPayment2,
          entryPayment: entryPayment2,
          timerCommit,
          timerReveal,
        },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Player number must be beetween 2-15')
  })

  test('throws error if timerCommit/timerReveal is less than 5 minutes or more then 7 days', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 100_000
    const mbr = (await client.send.getRequiredMbr()).return!

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    const mbrPayment2 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment2 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    const mbrPayment3 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment3 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    const mbrPayment4 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment4 = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    await expect(
      client.send.createNewGame({
        args: {
          maxPlayers,
          entryFee,
          mbr: mbrPayment,
          entryPayment,
          timerCommit: 3,
          timerReveal: 400,
        },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Commit timer must be beetween 5 minutes and 7 days')

    await expect(
      client.send.createNewGame({
        args: {
          maxPlayers,
          entryFee,
          mbr: mbrPayment2,
          entryPayment: entryPayment2,
          timerCommit: 999999999,
          timerReveal: 400,
        },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Commit timer must be beetween 5 minutes and 7 days')

    await expect(
      client.send.createNewGame({
        args: {
          maxPlayers,
          entryFee,
          mbr: mbrPayment3,
          entryPayment: entryPayment3,
          timerCommit: 350,
          timerReveal: 100,
        },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Reveal timer must be beetween 5 minutes and 7 days')

    await expect(
      client.send.createNewGame({
        args: {
          maxPlayers,
          entryFee,
          mbr: mbrPayment4,
          entryPayment: entryPayment4,
          timerCommit: 350,
          timerReveal: 999999999,
        },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Reveal timer must be beetween 5 minutes and 7 days')
  })

  test('throws error if entryFee is less than 1', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 0
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    await expect(
      client.send.createNewGame({
        args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Participation fee must be beetween 1 - 500000000')
  })

  test('throws error if entryFee is too high', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 600000000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    await expect(
      client.send.createNewGame({
        args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Participation fee must be beetween 1 - 500000000')
  })

  test('throws error if MBR payment is not to the contract', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: testAccount.addr,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    await expect(
      client.send.createNewGame({
        args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('MBR payment must be to the contract')
  })

  test('throws error if MBR payment is less than required', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(Number(mbr) - 1),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    await expect(
      client.send.createNewGame({
        args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Insufficient MBR')
  })

  test('throws error if entryPayment is not to the contract', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: testAccount.addr,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    await expect(
      client.send.createNewGame({
        args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Entry fee payment must be to the contract')
  })

  test('throws error if entryPayment amount is not equal to entryFee', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee + 1),
    })

    await expect(
      client.send.createNewGame({
        args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('Payment amount must be the entry fee')
  })

  test('allows multiple players to join a game', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 5
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const dispenser = await algorand.account.localNetDispenser()
    await algorand.account.ensureFunded(testAccount.addr, dispenser, AlgoAmount.MicroAlgos(200000))

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const joiner1 = algorand.account.random()
    const joinPayment1 = algorand.createTransaction.payment({
      sender: joiner1.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await algorand.account.ensureFunded(joiner1.addr, dispenser, AlgoAmount.MicroAlgos(200000))

    await client.send.joinGame({
      args: { gameId, payment: joinPayment1 },
      sender: joiner1.addr,
    })

    const joiner2 = algorand.account.random()
    const joinPayment2 = algorand.createTransaction.payment({
      sender: joiner2.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await algorand.account.ensureFunded(joiner2.addr, dispenser, AlgoAmount.MicroAlgos(200000))

    await client.send.joinGame({
      args: { gameId, payment: joinPayment2 },
      sender: joiner2.addr,
    })

    const game = (await client.state.box.games.value(gameId))!

    expect(Number(game.currentPlayerCount)).toBe(3) // creator + 2 joiner
    expect(game.players[0]).toEqual(testAccount.addr.toString())
    expect(game.players[1]).toEqual(joiner1.addr.toString())
    expect(game.players[2]).toEqual(joiner2.addr.toString())
  })

  test('error game full', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const maxPlayers = 2
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const dispenser = await algorand.account.localNetDispenser()
    await algorand.account.ensureFunded(testAccount.addr, dispenser, AlgoAmount.MicroAlgos(200000))

    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const joiner1 = algorand.account.random()
    const joinPayment1 = algorand.createTransaction.payment({
      sender: joiner1.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await algorand.account.ensureFunded(joiner1.addr, dispenser, AlgoAmount.MicroAlgos(200000))

    await client.send.joinGame({
      args: { gameId, payment: joinPayment1 },
      sender: joiner1.addr,
    })

    const joiner2 = algorand.account.random()
    const joinPayment2 = algorand.createTransaction.payment({
      sender: joiner2.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await algorand.account.ensureFunded(joiner2.addr, dispenser, AlgoAmount.MicroAlgos(200000))

    await expect(() =>
      client.send.joinGame({
        args: { gameId, payment: joinPayment2 },
        sender: joiner2.addr,
      }),
    ).rejects.toThrow('Game is full')
  })

  test('delete game and refund players', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))
    const maxPlayers = 3
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const joiner = algorand.account.random()
    const joinPayment = algorand.createTransaction.payment({
      sender: joiner.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(300_000))
    await client.send.joinGame({
      args: { gameId, payment: joinPayment },
      sender: joiner.addr,
    })

    await client.send.deleteGame({
      args: { gameId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgos(4000),
    })
    await expect(
      client.send.deleteGame({
        args: { gameId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(15000),
      }),
    ).rejects.toThrow('Game does not exist')
  })

  test('deleteGame fallisce se chiamato da non-creatore', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))
    const maxPlayers = 3
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const notCreator = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(notCreator.addr, AlgoAmount.MicroAlgos(200_000))

    await expect(
      client.send.deleteGame({
        args: { gameId },
        sender: notCreator.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(4000),
      }),
    ).rejects.toThrow('Only the creator can delete the game')
  })

  test('deleteGame fallisce se il gioco è già iniziato', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))
    const maxPlayers = 3
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    for (let i = 1; i < maxPlayers; i++) {
      const joiner = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
      const joinPayment = algorand.createTransaction.payment({
        sender: joiner.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(entryFee),
      })
      await client.send.joinGame({
        args: { gameId, payment: joinPayment },
        sender: joiner.addr,
      })
    }

    await expect(
      client.send.deleteGame({
        args: { gameId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(4000),
      }),
    ).rejects.toThrow('Game has started, deletion not possible')
  })

  test('backOff: il giocatore può ritirarsi prima che il gioco inizi', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))
    const maxPlayers = 3
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const joiner = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
    const joinPayment = algorand.createTransaction.payment({
      sender: joiner.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await client.send.joinGame({
      args: { gameId, payment: joinPayment },
      sender: joiner.addr,
    })

    await client.send.backOff({
      args: { gameId },
      sender: joiner.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgos(4000),
    })

    const game = await client.state.box.games.value(gameId)
    expect(Number(game?.currentPlayerCount)).toBe(1)
    expect(Number(game?.balance)).toBe(entryFee)
  })

  test('backOff: fallisce se non sei un giocatore', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))
    const maxPlayers = 3
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const stranger = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(stranger.addr, AlgoAmount.MicroAlgos(200_000))

    await expect(
      client.send.backOff({
        args: { gameId },
        sender: stranger.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(4000),
      }),
    ).rejects.toThrow('You are not a player in this game')
  })

  test('backOff: fallisce se il gioco è già iniziato', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))
    const maxPlayers = 7
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    for (let i = 1; i < maxPlayers; i++) {
      const joiner = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
      const joinPayment = algorand.createTransaction.payment({
        sender: joiner.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(entryFee),
      })
      await client.send.joinGame({
        args: { gameId, payment: joinPayment },
        sender: joiner.addr,
      })
    }

    await expect(
      client.send.backOff({
        args: { gameId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(4000),
      }),
    ).rejects.toThrow('You cannot withdraw after the game has started')
  })

  test('commit: un giocatore può committare se il gioco è pieno e non ha già committato', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    const maxPlayers = 2
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const joiner = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
    const joinPayment = algorand.createTransaction.payment({
      sender: joiner.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await client.send.joinGame({
      args: { gameId, payment: joinPayment },
      sender: joiner.addr,
    })

    const commitment1 = new Uint8Array(32)
    await client.send.commit({
      args: { gameId, commitment: commitment1 },
      sender: testAccount.addr,
    })

    const commitment2 = new Uint8Array(32)
    await client.send.commit({
      args: { gameId, commitment: commitment2 },
      sender: joiner.addr,
    })

    const game = await client.state.box.games.value(gameId)
    expect(game?.hasCommitted[0]).toBe(true)
    expect(game?.hasCommitted[1]).toBe(true)
    expect(game?.deadline).toBeGreaterThan(0)
  })

  test('errore se chiamante non giocatore', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    const maxPlayers = 2
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const stranger = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(stranger.addr, AlgoAmount.MicroAlgos(200_000))
    const commitment = new Uint8Array(32)
    await expect(
      client.send.commit({
        args: { gameId, commitment },
        sender: stranger.addr,
      }),
    ).rejects.toThrow('You are not a player in this game')
  })

  test('errore commit con gioco non pieno', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    const maxPlayers = 2
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const commitment = new Uint8Array(32)
    await expect(
      client.send.commit({
        args: { gameId, commitment },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('The game is not full yet')
  })

  test('errore già committato', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    const maxPlayers = 2
    const entryFee = 100_000
    const timerCommit = 300
    const timerReveal = 300
    const mbr = (await client.send.getRequiredMbr()).return!
    const mbrPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })
    const entryPayment = algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })

    const result = await client.send.createNewGame({
      args: { maxPlayers, entryFee, mbr: mbrPayment, entryPayment, timerCommit, timerReveal },
      sender: testAccount.addr,
    })
    const gameId = result.return!

    const joiner = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
    const joinPayment = algorand.createTransaction.payment({
      sender: joiner.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(entryFee),
    })
    await client.send.joinGame({
      args: { gameId, payment: joinPayment },
      sender: joiner.addr,
    })

    const commitment = new Uint8Array(32)
    await client.send.commit({
      args: { gameId, commitment: commitment },
      sender: testAccount.addr,
    })

    await expect(
      client.send.commit({
        args: { gameId, commitment },
        sender: testAccount.addr,
      }),
    ).rejects.toThrow('You have already committed')
  })
})
