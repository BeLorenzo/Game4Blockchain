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

    const { appClient } = await factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
      suppressLog: true,
    })

    // Fund contract to maintain minimum balance
    await localnet.algorand.account.ensureFunded(appClient.appAddress, account.addr, AlgoAmount.MicroAlgos(200_000))

    return { client: appClient }
  }

  // Helper function to create game setup parameters
  const createGameParams = (maxPlayers: number, entryFee: number, timerCommit: number, timerReveal: number) => ({
    maxPlayers,
    entryFee,
    timerCommit,
    timerReveal,
  })

  // Helper function to create payment transactions with unique notes
  const createPayments = async (client: any, testAccount: Account, entryFee: number, note?: string) => {
    const mbr = (await client.send.getRequiredMbr()).return!
    const uniqueNote = note || `test-${Date.now()}-${Math.random()}`

    return {
      mbrPayment: localnet.context.algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbr),
        note: new TextEncoder().encode(uniqueNote),
      }),
      entryPayment: localnet.context.algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(entryFee),
        note: new TextEncoder().encode(uniqueNote),
      }),
    }
  }

  test('creates a new game on localnet', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const params = createGameParams(5, 100_000, 300, 300)
    const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

    const result = await client.send.createNewGame({
      args: { ...params, mbr: mbrPayment, entryPayment },
      sender: testAccount.addr,
    })

    const gameId = result.return!
    const game = (await client.state.box.games.value(gameId))!

    expect(Number(gameId)).toBeGreaterThan(0)
    expect(Number(game.balance)).toBe(params.entryFee)
    expect(game.players.length).toBe(15)
    expect(Number(game.currentPlayerCount)).toBe(1)
    expect(game.hasRevealed[0]).toBe(false)
    expect(game.players[0]).toEqual(testAccount.addr.toString())
  })

  describe('Game creation validation', () => {
    test('throws error if maxPlayers is less than 2 or more than 15', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, 100_000, 'test-maxplayers-1')
      const { mbrPayment: mbrPayment2, entryPayment: entryPayment2 } = await createPayments(
        client,
        testAccount,
        100_000,
        'test-maxplayers-2',
      )

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(1, 100_000, 300, 300), mbr: mbrPayment, entryPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Player number must be beetween 2-15')

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(100, 100_000, 300, 300), mbr: mbrPayment2, entryPayment: entryPayment2 },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Player number must be beetween 2-15')
    })

    test('throws error if timerCommit/timerReveal is less than 5 minutes or more than 7 days', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      // Use unique notes for each transaction to avoid "transaction already in ledger"
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, 100_000, 'test-timer-1')
      const { mbrPayment: mbrPayment2, entryPayment: entryPayment2 } = await createPayments(
        client,
        testAccount,
        100_000,
        'test-timer-2',
      )
      const { mbrPayment: mbrPayment3, entryPayment: entryPayment3 } = await createPayments(
        client,
        testAccount,
        100_000,
        'test-timer-3',
      )
      const { mbrPayment: mbrPayment4, entryPayment: entryPayment4 } = await createPayments(
        client,
        testAccount,
        100_000,
        'test-timer-4',
      )

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 3, 400), mbr: mbrPayment, entryPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Commit timer must be beetween 5 minutes and 7 days')

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 999999999, 400), mbr: mbrPayment2, entryPayment: entryPayment2 },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Commit timer must be beetween 5 minutes and 7 days')

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 350, 100), mbr: mbrPayment3, entryPayment: entryPayment3 },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Reveal timer must be beetween 5 minutes and 7 days')

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 350, 999999999), mbr: mbrPayment4, entryPayment: entryPayment4 },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Reveal timer must be beetween 5 minutes and 7 days')
    })

    test('throws error if entryFee is less than 1 or too high', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, 0, 'test-entryfee-1')
      const { mbrPayment: mbrPayment2, entryPayment: entryPayment2 } = await createPayments(
        client,
        testAccount,
        600000000,
        'test-entryfee-2',
      )

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 0, 300, 300), mbr: mbrPayment, entryPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Participation fee must be beetween 1 - 500000000')

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 600000000, 300, 300), mbr: mbrPayment2, entryPayment: entryPayment2 },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Participation fee must be beetween 1 - 500000000')
    })

    test('throws error if MBR payment is not to the contract or insufficient', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const mbr = (await client.send.getRequiredMbr()).return!
      const { entryPayment } = await createPayments(client, testAccount, 100_000, 'test-mbr-1')

      // Test wrong receiver
      const wrongReceiverPayment = algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: testAccount.addr, // Wrong receiver
        amount: AlgoAmount.MicroAlgos(mbr),
        note: new TextEncoder().encode('test-mbr-wrong-receiver'),
      })

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 300, 300), mbr: wrongReceiverPayment, entryPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('MBR payment must be to the contract')

      // Test insufficient MBR - create a new payment with insufficient amount
      const insufficientMBRPayment = algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(Number(mbr) - 1000),
        note: new TextEncoder().encode('test-mbr-insufficient'),
      })
      const { entryPayment: entryPayment2 } = await createPayments(client, testAccount, 100_000, 'test-mbr-2')

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 300, 300), mbr: insufficientMBRPayment, entryPayment: entryPayment2 },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Insufficient MBR')
    })

    test('throws error if entryPayment is not to the contract or amount mismatch', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const { mbrPayment } = await createPayments(client, testAccount, 100_000, 'test-entry-1')

      // Test wrong receiver
      const wrongReceiverEntryPayment = algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: testAccount.addr, // Wrong receiver
        amount: AlgoAmount.MicroAlgos(100_000),
        note: new TextEncoder().encode('test-entry-wrong-receiver'),
      })

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 300, 300), mbr: mbrPayment, entryPayment: wrongReceiverEntryPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Entry fee payment must be to the contract')

      // Test wrong amount
      const wrongAmountEntryPayment = algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(100_001), // Wrong amount
        note: new TextEncoder().encode('test-entry-wrong-amount'),
      })
      const { mbrPayment: mbrPayment2 } = await createPayments(client, testAccount, 100_000, 'test-entry-2')

      await expect(
        client.send.createNewGame({
          args: { ...createGameParams(5, 100_000, 300, 300), mbr: mbrPayment2, entryPayment: wrongAmountEntryPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Payment amount must be the entry fee')
    })
  })

  describe('Game joining', () => {
    test('allows multiple players to join a game', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const params = createGameParams(5, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)
      const dispenser = await algorand.account.localNetDispenser()

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      // Join first player
      const joiner1 = algorand.account.random()
      const joinPayment1 = algorand.createTransaction.payment({
        sender: joiner1.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-1'),
      })
      await algorand.account.ensureFunded(joiner1.addr, dispenser, AlgoAmount.MicroAlgos(200000))
      await client.send.joinGame({ args: { gameId, payment: joinPayment1 }, sender: joiner1.addr })

      // Join second player
      const joiner2 = algorand.account.random()
      const joinPayment2 = algorand.createTransaction.payment({
        sender: joiner2.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-2'),
      })
      await algorand.account.ensureFunded(joiner2.addr, dispenser, AlgoAmount.MicroAlgos(200000))
      await client.send.joinGame({ args: { gameId, payment: joinPayment2 }, sender: joiner2.addr })

      const game = (await client.state.box.games.value(gameId))!
      expect(Number(game.currentPlayerCount)).toBe(3) // creator + 2 joiners
      expect(game.players[0]).toEqual(testAccount.addr.toString())
      expect(game.players[1]).toEqual(joiner1.addr.toString())
      expect(game.players[2]).toEqual(joiner2.addr.toString())
    })

    test('throws error when game is full', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const params = createGameParams(2, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)
      const dispenser = await algorand.account.localNetDispenser()

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      // Join first player (fills the game)
      const joiner1 = algorand.account.random()
      const joinPayment1 = algorand.createTransaction.payment({
        sender: joiner1.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-full-1'),
      })
      await algorand.account.ensureFunded(joiner1.addr, dispenser, AlgoAmount.MicroAlgos(200000))
      await client.send.joinGame({ args: { gameId, payment: joinPayment1 }, sender: joiner1.addr })

      // Try to join when game is full
      const joiner2 = algorand.account.random()
      const joinPayment2 = algorand.createTransaction.payment({
        sender: joiner2.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-full-2'),
      })
      await algorand.account.ensureFunded(joiner2.addr, dispenser, AlgoAmount.MicroAlgos(200000))

      await expect(
        client.send.joinGame({ args: { gameId, payment: joinPayment2 }, sender: joiner2.addr }),
      ).rejects.toThrow('Game is full')
    })
  })

  describe('Game deletion', () => {
    test('deletes game and refunds players', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = createGameParams(3, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      const joiner = algorand.account.random()
      const joinPayment = algorand.createTransaction.payment({
        sender: joiner.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-delete'),
      })
      await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(300_000))
      await client.send.joinGame({ args: { gameId, payment: joinPayment }, sender: joiner.addr })

      await client.send.deleteGame({
        args: { gameId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(4000),
      })

      // Verify game no longer exists
      await expect(
        client.send.deleteGame({
          args: { gameId },
          sender: testAccount.addr,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgos(15000),
        }),
      ).rejects.toThrow('Game does not exist')
    })

    test('fails if called by non-creator', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = createGameParams(3, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
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

    test('fails if game has already started', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = createGameParams(3, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      // Fill the game with players
      for (let i = 1; i < params.maxPlayers; i++) {
        const joiner = algorand.account.random()
        await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
        const joinPayment = algorand.createTransaction.payment({
          sender: joiner.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(params.entryFee),
          note: new TextEncoder().encode(`test-joiner-started-${i}`),
        })
        await client.send.joinGame({ args: { gameId, payment: joinPayment }, sender: joiner.addr })
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
  })

  describe('Player withdrawal (backOff)', () => {
    test('player can withdraw before game starts', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = createGameParams(3, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      const joiner = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
      const joinPayment = algorand.createTransaction.payment({
        sender: joiner.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-backoff'),
      })
      await client.send.joinGame({ args: { gameId, payment: joinPayment }, sender: joiner.addr })

      await client.send.backOff({
        args: { gameId },
        sender: joiner.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(4000),
      })

      const game = await client.state.box.games.value(gameId)
      expect(Number(game?.currentPlayerCount)).toBe(1)
      expect(Number(game?.balance)).toBe(params.entryFee)
    })

    test('fails if caller is not a player', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = createGameParams(3, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
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

    test('fails if game has already started', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      // Reduced from 7 to 3 players to avoid timeout
      const params = createGameParams(3, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(
        client,
        testAccount,
        params.entryFee,
        'test-backoff-timeout',
      )

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      // Fill the game with players (only need 2 more joiners for maxPlayers=3)
      for (let i = 1; i < params.maxPlayers; i++) {
        const joiner = algorand.account.random()
        await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
        const joinPayment = algorand.createTransaction.payment({
          sender: joiner.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(params.entryFee),
          note: new TextEncoder().encode(`test-joiner-timeout-${i}`),
        })
        await client.send.joinGame({ args: { gameId, payment: joinPayment }, sender: joiner.addr })
      }

      await expect(
        client.send.backOff({
          args: { gameId },
          sender: testAccount.addr,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgos(4000),
        }),
      ).rejects.toThrow('You cannot withdraw after the game has started')
    }, 15000) // Increased timeout to 15 seconds
  })

  describe('Commit phase', () => {
    test('player can commit when game is full and has not committed yet', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const params = createGameParams(2, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      const joiner = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
      const joinPayment = algorand.createTransaction.payment({
        sender: joiner.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-commit'),
      })
      await client.send.joinGame({ args: { gameId, payment: joinPayment }, sender: joiner.addr })

      const commitment1 = new Uint8Array(32)
      await client.send.commit({ args: { gameId, commitment: commitment1 }, sender: testAccount.addr })

      const commitment2 = new Uint8Array(32)
      await client.send.commit({ args: { gameId, commitment: commitment2 }, sender: joiner.addr })

      const game = await client.state.box.games.value(gameId)
      expect(game?.hasCommitted[0]).toBe(true)
      expect(game?.hasCommitted[1]).toBe(true)
      expect(game?.deadline).toBeGreaterThan(0)
    })

    test('fails if caller is not a player', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const params = createGameParams(2, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      const stranger = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(stranger.addr, AlgoAmount.MicroAlgos(200_000))
      const commitment = new Uint8Array(32)

      await expect(client.send.commit({ args: { gameId, commitment }, sender: stranger.addr })).rejects.toThrow(
        'You are not a player in this game',
      )
    })

    test('fails if game is not full', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const params = createGameParams(2, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      const commitment = new Uint8Array(32)
      await expect(client.send.commit({ args: { gameId, commitment }, sender: testAccount.addr })).rejects.toThrow(
        'The game is not full yet',
      )
    })

    test('fails if player has already committed', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const params = createGameParams(2, 100_000, 300, 300)
      const { mbrPayment, entryPayment } = await createPayments(client, testAccount, params.entryFee)

      const result = await client.send.createNewGame({
        args: { ...params, mbr: mbrPayment, entryPayment },
        sender: testAccount.addr,
      })
      const gameId = result.return!

      const joiner = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(joiner.addr, AlgoAmount.MicroAlgos(200_000))
      const joinPayment = algorand.createTransaction.payment({
        sender: joiner.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(params.entryFee),
        note: new TextEncoder().encode('test-joiner-already-committed'),
      })
      await client.send.joinGame({ args: { gameId, payment: joinPayment }, sender: joiner.addr })

      const commitment = new Uint8Array(32)
      await client.send.commit({ args: { gameId, commitment }, sender: testAccount.addr })

      await expect(client.send.commit({ args: { gameId, commitment }, sender: testAccount.addr })).rejects.toThrow(
        'You have already committed',
      )
    })
  })
})
