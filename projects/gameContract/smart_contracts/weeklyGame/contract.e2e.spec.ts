import { Config } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account } from 'algosdk'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { WeeklyGameFactory } from '../artifacts/weeklyGame/WeeklyGameClient'

describe('WeeklyGame Contract', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({ debug: true })
  })

  beforeEach(localnet.newScope)

  const deploy = async (account: Account & TransactionSignerAccount) => {
    const factory = localnet.algorand.client.getTypedAppFactory(WeeklyGameFactory, {
      defaultSender: account.addr,
      defaultSigner: account.signer,
    })

    const { appClient } = await factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
      suppressLog: true,
    })

    await localnet.algorand.account.ensureFundedFromEnvironment(
      appClient.appAddress,
      AlgoAmount.MicroAlgos(200_000_000),
    )
    return { client: appClient }
  }

  const createGameParams = async (startAt: number, endCommitAt: number, endRevealAt: number, participation: number) => {
    const now = (await localnet.context.algod.status().do()).lastRound
    const start = now + BigInt(startAt) + 5n
    const commit = start + BigInt(endCommitAt)
    const reveal = commit + BigInt(endRevealAt)

    return {
      startAt: start,
      endCommitAt: commit,
      endRevealAt: reveal,
      participation: BigInt(participation),
    }
  }

  // SHA256( itob(scelta) + salt )
  const getHash = (choice: number, salt: string) => {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return crypto
      .createHash('sha256')
      .update(Buffer.concat([b, Buffer.from(salt)]))
      .digest()
  }

  describe('Game Creation', () => {
    test('creates a new weekly game session successfully', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = await createGameParams(0, 300, 300, 1_000_000)
      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      const result = await client.send.createSession({
        args: { config: params, mbrPayment: mbrPayment },
        sender: testAccount.addr,
      })

      const sessionId = result.return!
      expect(sessionId).toBeDefined()
      expect(Number(sessionId)).toBeGreaterThanOrEqual(0)
    })

    test('throws error if MBR payment is insufficient', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = await createGameParams(0, 300, 300, 100_000)

      const badMbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(1000),
      })

      await expect(
        client.send.createSession({
          args: { config: params, mbrPayment: badMbrPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Insufficient MBR for session and day counters')
    })
  })

  describe('Join and Reveal Logic', () => {
    test('allows players to join and reveal valid days', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 5, 5, 500_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })

      const res = await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Player joins and reveals Monday (0)
      const hash = getHash(0, 'saltMonday')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(500_000),
          }),
        },
        sender: testAccount.addr,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('saltMonday') },
        sender: testAccount.addr,
      })

      const balance = await client.state.box.sessionBalances.value(sessionId)
      expect(balance).toBe(500_000n)
    })

    test('throws error if reveal day is invalid', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 5, 5, 500_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })

      const res = await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Player joins with commit for day 7 (invalid)
      const hash = getHash(7, 'saltInvalid')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(500_000),
          }),
        },
        sender: testAccount.addr,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      await expect(
        client.send.revealMove({
          args: { sessionId: sessionId, choice: 7n, salt: Buffer.from('saltInvalid') },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Invalid Day: must be between 0 and 6')
    })
  })

  describe('Prize Distribution Logic', () => {
    test('single player gets full prize when alone and cannot claim again', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 10, 10, 1_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })

      const res = await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Single player chooses Monday (0)
      const hash = getHash(0, 'saltSingle')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: testAccount.addr,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('saltSingle') },
        sender: testAccount.addr,
      })

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Player should get full prize (1,000,000)
      await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      // Verify player cannot claim again
      await expect(
        client.send.claimWinnings({
          args: { sessionId: sessionId },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Player has not revealed or already claimed')
    }, 30000)

    test('two players in different days split prize equally', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(3_000_000_000))

      const params = await createGameParams(0, 10, 10, 1_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })

      const res = await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Player 1: Monday (0)
      const hash1 = getHash(0, 'salt1')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash1),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: testAccount.addr,
      })
      // Player 2: Tuesday (1)
      const p2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
      const hash2 = getHash(1, 'salt2')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash2),
          payment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('salt1') },
        sender: testAccount.addr,
      })

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 1n, salt: Buffer.from('salt2') },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }
      const days = await client.state.box.days.value(sessionId)
      expect(days?.dom).toBe(0n)
      expect(days?.lun).toBe(1n)
      expect(days?.mar).toBe(1n)

      // Both players should get 1,000,000 each (total pot 2,000,000 / 2 active days = 1,000,000 per day)
      const p1Win = await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      const p2Win = await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: p2.addr,
        signer: p2.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      expect(p1Win.return).toBe(1000000n)
      expect(p1Win.return).toBe(p2Win.return)
    }, 30000)

    test('two players in same day split day prize equally', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(3_000_000_000))

      const params = await createGameParams(0, 10, 10, 1_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })

      const res = await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Both players choose Monday (0)
      const hash1 = getHash(0, 'salt1')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash1),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: testAccount.addr,
      })

      const p2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
      const hash2 = getHash(0, 'salt2')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash2),
          payment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('salt1') },
        sender: testAccount.addr,
      })

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('salt2') },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      const days = await client.state.box.days.value(sessionId)
      expect(days?.lun).toBe(2n)
      expect(days?.mar).toBe(0n)

      // Both players should get 1,000,000 each (total pot 2,000,000 / 1 active day = 2,000,000 per day / 2 players = 1,000,000 each)
      const p1Win = await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: p2.addr,
        signer: p2.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      expect(p1Win.return).toBe(1000000n)
    }, 30000)

    test('complex scenario with multiple days and players', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(5_000_000_000))

      const params = await createGameParams(0, 30, 10, 1_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })

      const res = await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Setup: 3 days active with different number of players
      // Monday (0): 2 players
      // Tuesday (1): 1 player
      // Wednesday (2): 3 players
      // Total pot: 6,000,000

      const players = []
      const days = [0, 1, 2, 0, 2, 2] // Day choices for 6 players

      for (let i = 0; i < 6; i++) {
        const player = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) {
          await algorand.account.ensureFundedFromEnvironment(player, AlgoAmount.Algos(5))
        }

        const hash = getHash(days[i], `salt${i}`)
        await client.send.joinSession({
          args: {
            sessionId: sessionId,
            commit: new Uint8Array(hash),
            payment: await algorand.createTransaction.payment({
              sender: player.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(1_000_000),
            }),
          },
          sender: player.addr,
          signer: player.signer,
        })
        players.push(player)
      }

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // All players reveal
      for (let i = 0; i < 6; i++) {
        await client.send.revealMove({
          args: { sessionId: sessionId, choice: BigInt(days[i]), salt: Buffer.from(`salt${i}`) },
          sender: players[i].addr,
          signer: players[i].signer,
        })
      }

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      const dayz = await client.state.box.days.value(sessionId)
      expect(dayz?.lun).toBe(2n)
      expect(dayz?.mar).toBe(1n)
      expect(dayz?.mer).toBe(3n)
      expect(dayz?.gio).toBe(0n)

      // All players claim winnings
      const win0 = await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: players[0].addr,
        signer: players[0].signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: players[1].addr,
        signer: players[1].signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      const win2 = await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: players[2].addr,
        signer: players[2].signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      const win3 = await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: players[3].addr,
        signer: players[3].signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: players[4].addr,
        signer: players[4].signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: players[5].addr,
        signer: players[5].signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      expect(win0.return).toBe(1000000n)
      expect(win0.return).toBe(win3.return)
      expect(win2.return).toBe(666666n)
    }, 30000)

    test('throws error if claiming before reveal period ends', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 5, 5, 1_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })

      const res = await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      const hash = getHash(0, 'salt')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: testAccount.addr,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('salt') },
        sender: testAccount.addr,
      })

      // Try to claim immediately (before reveal period ends)
      await expect(
        client.send.claimWinnings({
          args: { sessionId: sessionId },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Game is not finished yet')
    }, 30000)
  })

  describe('MBR Calculations', () => {
    test('calculates correct MBR for new game and join', async () => {
      const { testAccount } = localnet.context
      const { client } = await deploy(testAccount)

      const newGameMBR = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return
      const joinMBR = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return

      expect(newGameMBR).toBeDefined()
      expect(joinMBR).toBeDefined()
      expect(Number(newGameMBR)).toBeGreaterThan(Number(joinMBR))
    })
  })
})
