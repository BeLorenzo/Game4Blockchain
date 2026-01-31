/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { Config } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account, ALGORAND_ZERO_ADDRESS_STRING } from 'algosdk'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { RockPaperScissorsFactory } from '../artifacts/RockPaperScissors/RockPaperScissorsClient'

describe('RockPaperScissors Contract', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({ debug: true })
  })

  beforeEach(localnet.newScope)

  const deploy = async (account: Account & TransactionSignerAccount) => {
    const factory = localnet.algorand.client.getTypedAppFactory(RockPaperScissorsFactory, {
      defaultSender: account.addr,
      defaultSigner: account.signer,
    })

    const { appClient } = await factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
      suppressLog: true,
    })

    // Fund the app for minimum box creation if necessary (though user pays in this contract)
    await localnet.algorand.account.ensureFundedFromEnvironment(
      appClient.appAddress,
      AlgoAmount.MicroAlgos(200_000_000),
    )
    return { client: appClient }
  }

  // HELPER: Returns a simple object with BigInts
  const createGameParams = async (
    startAt: number,
    endCommitAt: number, // Duration in blocks to add to startAt
    endRevealAt: number, // Duration in blocks to add to endCommitAt
    participation: number,
  ) => {
    const now = (await localnet.context.algod.status().do()).lastRound
    // Calculate absolute rounds as required by the contract
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

  // SHA256( itob(choice) + salt )
  const getHash = (choice: number, salt: string) => {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return crypto
      .createHash('sha256')
      .update(Buffer.concat([b, Buffer.from(salt)]))
      .digest()
  }

  describe('Game creation', () => {
    test('creates a new game session successfully', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      // 1. Prepare valid parameters
      const params = await createGameParams(0, 300, 300, 1_000_000)

      // 2. Calculate MBR by calling contract method (client-side simulation)
      // The contract expects payment for: ConfigBox + BalanceBox + PlayersBox + StateBox
      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

      // 3. Create MBR payment transaction
      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      // 4. Call createSession
      const result = await client.send.createSession({
        args: { config: params, mbrPayment: mbrPayment },
        sender: testAccount.addr,
      })

      const sessionId = result.return!

      expect(sessionId).toBeDefined()

      // Basic logic verification
      const balance = await client.state.box.sessionBalances.value(sessionId)
      const session = await client.state.box.gameSessions.value(sessionId)
      const players = await client.state.box.sessionPlayers.value(sessionId)
      expect(Number(sessionId)).toBeGreaterThanOrEqual(0)
      expect(balance).toEqual(0n)
      expect(session?.startAt).toBe(params.startAt)
      expect(players?.p1).toBe(ALGORAND_ZERO_ADDRESS_STRING)
    })

    test('throws error if timestamps are inconsistent (Start > End)', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const badParams = {
        startAt: 1000n,
        endCommitAt: 10n,
        endRevealAt: 50n,
        participation: 100_000n,
      }

      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      // Must fail with abstract contract assertion
      await expect(
        client.send.createSession({
          args: { config: badParams, mbrPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Invalid timeline: start must be before commit end')
    })

    test('throws error if MBR payment is insufficient', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = await createGameParams(0, 300, 300, 100_000)

      // Pay less than required (e.g., fixed 1 Algo which might not be enough or just wrong)
      const badMbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(1),
      })

      await expect(
        client.send.createSession({
          args: { config: params, mbrPayment: badMbrPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Payment must cover exact MBR for session data')
    })

    test('throws error if MBR payment is not to the contract', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = await createGameParams(0, 300, 300, 100_000)

      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const random = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(random, AlgoAmount.Algos(1))
      const badMbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: random.addr,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      await expect(
        client.send.createSession({
          args: { config: params, mbrPayment: badMbrPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('MBR payment must be sent to contract')
    })

    test('fails if start time is in the past', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      // 1. INVALID Config: Start in the past
      const currentBlock = (await algod.status().do()).lastRound
      const badParams = {
        startAt: currentBlock - 2n,
        endCommitAt: currentBlock + 100n,
        endRevealAt: currentBlock + 200n,
        participation: 100_000n,
      }

      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      // MBR payment still needed to pass initial protocol checks
      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      await expect(
        client.send.createSession({
          args: { config: badParams, mbrPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Invalid start time: cannot start in the past')
    })

    test('fails if start time is after commit deadline', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const currentTime = BigInt(Math.floor(Date.now() / 1000))

      // 2. INVALID Config: Start after commit end
      // startAt (200) > endCommitAt (100) -> Error
      const badParams = {
        startAt: currentTime + 200n,
        endCommitAt: currentTime + 100n,
        endRevealAt: currentTime + 300n,
        participation: 100_000n,
      }
      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      await expect(
        client.send.createSession({
          args: { config: badParams, mbrPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Invalid timeline: start must be before commit end')
    })

    test('fails if commit deadline is after reveal deadline', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const currentTime = BigInt(Math.floor(Date.now() / 1000))

      const badParams = {
        startAt: currentTime + 100n,
        endCommitAt: currentTime + 300n,
        endRevealAt: currentTime + 200n,
        participation: 100_000n,
      }

      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      await expect(
        client.send.createSession({
          args: { config: badParams, mbrPayment },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Invalid timeline: commit end must be before reveal end')
    })
  })

  describe('Join Session Logic', () => {
    test('Player 1 and Player 2 join successfully', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      // 1. SESSION CREATION
      const fee = 1_000_000
      const params = await createGameParams(0, 30, 30, fee)

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

      // 2. JOIN PLAYER 1
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      const feeTx1 = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(fee),
      })

      const mbrTx1 = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(joinMbr),
      })

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      // Random commit (32 bytes dummy)
      const commit1 = new Uint8Array(32).fill(1)

      await client.send.joinSession({
        args: { sessionId: sessionId, commit: commit1, payment: feeTx1, mbrPayment: mbrTx1 },
        sender: testAccount.addr,
      })

      // 3. JOIN PLAYER 2 (New Account)
      const player2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.Algos(10))

      const feeTx2 = await algorand.createTransaction.payment({
        sender: player2.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(fee),
      })
      const mbrTx2 = await algorand.createTransaction.payment({
        sender: player2.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(joinMbr),
      })

      const commit2 = new Uint8Array(32).fill(2)

      await client.send.joinSession({
        args: { sessionId: sessionId, commit: commit2, payment: feeTx2, mbrPayment: mbrTx2 },
        sender: player2.addr,
        signer: player2.signer, // Sign as P2
      })
    }, 50000)

    test('Fail: Third player tries to join (Session Full)', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      // 1. SETUP SESSION
      const fee = 100_000
      const params = await createGameParams(0, 300, 300, fee)
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
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      // 2. FILL SESSION (P1 and P2 join)
      // P1 Join
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(32),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(fee),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      // P2 Join
      const player2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.Algos(5))
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(32),
          payment: await algorand.createTransaction.payment({
            sender: player2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(fee),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: player2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: player2.addr,
        signer: player2.signer,
      })

      // 3. P3 ATTEMPTS TO JOIN (Must Fail)
      const player3 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(player3, AlgoAmount.Algos(5))

      const feeTx3 = await algorand.createTransaction.payment({
        sender: player3.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(fee),
      })
      const mbrTx3 = await algorand.createTransaction.payment({
        sender: player3.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(joinMbr),
      })

      await expect(
        client.send.joinSession({
          args: { sessionId: sessionId, commit: new Uint8Array(32), payment: feeTx3, mbrPayment: mbrTx3 },
          sender: player3.addr,
          signer: player3.signer,
        }),
      ).rejects.toThrow('Session is full (Max 2 players)')
    }, 30_000)

    test('Fail: Player tries to join twice', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)

      // 1. SETUP
      const fee = 100_000
      const params = await createGameParams(0, 300, 300, fee)
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

      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      // 2. FIRST JOIN (OK)
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(32),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(fee),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      // 3. SECOND JOIN SAME ACCOUNT (Error)
      await expect(
        client.send.joinSession({
          args: {
            sessionId: sessionId,
            commit: new Uint8Array(32),
            payment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(fee),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(joinMbr),
            }),
          },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Player already joined this session')
    })

    test('Fail: Insufficient MBR payment', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)

      // 1. SETUP
      const fee = 100_000
      const params = await createGameParams(0, 300, 300, fee)
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

      // 2. WRONG MBR
      const feeTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(fee),
      })

      // Paying 1000 microAlgo instead of required (~29700)
      const badMbrTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(1000),
      })

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      await expect(
        client.send.joinSession({
          args: { sessionId: sessionId, commit: new Uint8Array(32), payment: feeTx, mbrPayment: badMbrTx },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Insufficient MBR payment')
    })

    test('Fail: Join before start time', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      // 1. SETUP: Session starting in 5000 rounds
      const fee = 100_000
      const params = await createGameParams(5000, 300, 300, fee)

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

      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      // 2. TRY JOIN IMMEDIATELY (Error)
      await expect(
        client.send.joinSession({
          args: {
            sessionId: sessionId,
            commit: new Uint8Array(32),
            payment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(fee),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(joinMbr),
            }),
          },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Game session has not started yet')
    })
  })
  describe('Internal Getters & State Logic', () => {
    // Helper to manually calculate expected MBR (formula: 2500 + 400 * (K + V))
    const calcMBR = (keySize: number, valSize: number) => 2500 + 400 * (keySize + valSize)

    test('getRequiredMBR calculates exact amounts correctly', async () => {
      const { testAccount } = localnet.context
      const { client } = await deploy(testAccount)

      const expectedJoinMBR = BigInt(calcMBR(36, 32))

      const joinResult = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return
      expect(joinResult).toBe(expectedJoinMBR)

      const expectedNewGameMBR = BigInt(calcMBR(10, 32) + calcMBR(12, 8) + calcMBR(11, 64))

      const newGameResult = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return

      expect(newGameResult).toBe(expectedNewGameMBR)
    })

    test('getSessionBalance tracks accumulated payments correctly', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const fee = 500_000
      const params = await createGameParams(0, 300, 300, fee)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

      const sessionRes = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })
      const sessionId = sessionRes.return!

      let currentBalance = await client.state.box.sessionBalances.value(sessionId)
      expect(currentBalance).toBe(0n)

      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      await client.send.joinSession({
        args: {
          sessionId,
          commit: new Uint8Array(32),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(fee),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      currentBalance = await client.state.box.sessionBalances.value(sessionId)
      expect(currentBalance).toBe(BigInt(fee))

      const p2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
      await client.send.joinSession({
        args: {
          sessionId,
          commit: new Uint8Array(32),
          payment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(fee),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: p2.addr,
        signer: p2.signer,
      })

      currentBalance = await client.state.box.sessionBalances.value(sessionId)
      expect(currentBalance).toBe(BigInt(fee * 2))
    })
  })
  describe('Reveal Move Logic', () => {
    test('Fail: Reveal Too Early (Commit phase active)', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)

      // 1. SETUP (LONG Commit: 500 blocks)
      const params = await createGameParams(0, 500, 20, 100_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const res = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      // 2. JOIN P1
      const hash = getHash(0, 'salt')
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      // 3. REVEAL IMMEDIATELY (Don't wait) -> ERROR
      await expect(
        client.send.revealMove({
          args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('salt') },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Commit phase is still active')
    })

    test('Fail: Cheating (Hash Mismatch)', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)

      const params = await createGameParams(0, 1, 20, 100_000)

      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const res = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      // 2. JOIN P1 (I promise ROCK / "A")
      const realHash = getHash(0, 'A')
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(realHash),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      // 4. REVEAL LIE (I say PAPER / "A") -> Different Hash -> ERROR
      await expect(
        client.send.revealMove({
          args: { sessionId: sessionId, choice: 1n, salt: Buffer.from('A') },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Invalid reveal: hash mismatch')
    }, 30_000) // Increased timeout to 30s because we must wait for buffer + duration

    test('Fail: Invalid Choice (> 2)', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)

      // 1. SETUP
      const params = await createGameParams(0, 2, 10, 100_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const res = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })
      const sessionId = res.return!

      // 2. JOIN P1
      const hash = getHash(3, 'salt')
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hash),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return! // Dummy transaction to advance blocks
      }

      // 4. REVEAL "3" -> ERROR
      await expect(
        client.send.revealMove({
          args: { sessionId: sessionId, choice: 3n, salt: Buffer.from('salt') },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Invalid choice: must be 0, 1, or 2')
    }, 30_000)
  })

  describe('Game Outcome Logic - Quite All Combinations', () => {
    test('Paper vs Rock -> P1 wins and gets full prize', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 4, 20, 100_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const res = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })

      const sessionId = res.return!
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      // P1: Paper (1)
      const hashP1 = getHash(1, 'saltP1')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP1),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      // P2: Rock (0)
      const p2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
      const hashP2 = getHash(0, 'saltP2')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP2),
          payment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 1n, salt: Buffer.from('saltP1') },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('saltP2') },
        sender: p2.addr,
        signer: p2.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

    const win = await client.send.claimWinnings({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee:AlgoAmount.MicroAlgo(3000)
    })

      expect(win.return).toBe(200_000n)
      // P1 should win (Paper beats Rock)
    })

    test('Scissors vs Paper -> P1 wins and gets full prize', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 4, 20, 100_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const res = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })

      const sessionId = res.return!
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      // P1: Scissors (2)
      const hashP1 = getHash(2, 'saltP1')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP1),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      // P2: Paper (1)
      const p2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
      const hashP2 = getHash(1, 'saltP2')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP2),
          payment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 2n, salt: Buffer.from('saltP1') },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 1n, salt: Buffer.from('saltP2') },
        sender: p2.addr,
        signer: p2.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

            while ((await algod.status().do()).lastRound < params.endRevealAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

    const win = await client.send.claimWinnings({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee:AlgoAmount.MicroAlgo(3000)
    })

      expect(win.return).toBe(200_000n)
    })

    test('Scissors vs Rock -> P2 wins and gets full prize', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 4, 20, 100_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const res = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })

      const sessionId = res.return!
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      // P1: Scissors (2)
      const hashP1 = getHash(2, 'saltP1')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP1),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      // P2: Rock (0)
      const p2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
      const hashP2 = getHash(0, 'saltP2')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP2),
          payment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 2n, salt: Buffer.from('saltP1') },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('saltP2') },
        sender: p2.addr,
        signer: p2.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

            while ((await algod.status().do()).lastRound < params.endRevealAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

    const win = await client.send.claimWinnings({
      args: { sessionId },
      sender: p2.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee:AlgoAmount.MicroAlgo(3000)
    })

      expect(win.return).toBe(200_000n)
    })

    test('Scissors vs Scissors -> tie and prize is split equally', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      const params = await createGameParams(0, 4, 20, 100_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const res = await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(newGameMbr),
          }),
        },
        sender: testAccount.addr,
      })

      const sessionId = res.return!
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      // Both players: Scissors (2)
      const hashP1 = getHash(2, 'saltP1')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP1),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: testAccount.addr,
      })

      const p2 = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
      const hashP2 = getHash(2, 'saltP2')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashP2),
          payment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(100_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: p2.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: p2.addr,
        signer: p2.signer,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 2n, salt: Buffer.from('saltP1') },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 2n, salt: Buffer.from('saltP2') },
        sender: p2.addr,
        signer: p2.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

            while ((await algod.status().do()).lastRound < params.endRevealAt) {
        ;(await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
      }

    const win = await client.send.claimWinnings({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee:AlgoAmount.MicroAlgo(3000)
    })

      expect(win.return).toBe(100_000n)
    })
  })

describe('Timeout Victory Logic', () => {
 const waitForRound = async (targetRound: bigint, client: any, algod: any) => {
    let current = BigInt((await algod.status().do()).lastRound)
    while (current < targetRound) {
      await client.send.getRequiredMbr({ args: { command: 'join' } })
      current = BigInt((await algod.status().do()).lastRound)
    }
  }

  test('Case 1: Success - Player 1 reveals, Player 2 does not. P1 claims victory after timeout', async () => {
    const { testAccount, algorand, algod } = localnet.context
    const { client } = await deploy(testAccount)
    
    const fee = 1_000_000
    const params = await createGameParams(0, 10, 10, fee)

    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    const createRes = await client.send.createSession({
      args: { 
        config: params, 
        mbrPayment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(newGameMbr) }) 
      },
      sender: testAccount.addr,
    })
    const sessionId = createRes.return!
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    await waitForRound(params.startAt, client, algod)

    const salt1 = 'salt1'
    const commit1 = getHash(0, salt1)
    
    await client.send.joinSession({
      args: { 
        sessionId, commit: commit1, 
        payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(fee) }),
        mbrPayment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(joinMbr) })
      },
      sender: testAccount.addr,
    })

    const player2 = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.Algos(10))
    const salt2 = 'salt2'
    const commit2 = getHash(1, salt2)

    await client.send.joinSession({
      args: { 
        sessionId, commit: commit2, 
        payment: await algorand.createTransaction.payment({ sender: player2.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(fee) }),
        mbrPayment: await algorand.createTransaction.payment({ sender: player2.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(joinMbr) })
      },
      sender: player2.addr,
      signer: player2.signer
    })

    await waitForRound(params.endCommitAt + 1n, client, algod)
    
    await client.send.revealMove({
      args: { sessionId, choice: 0, salt: Buffer.from(salt1) },
      sender: testAccount.addr
    })

    await waitForRound(params.endRevealAt + 1n, client, algod)

    const p1BalanceBefore  = Number((await algorand.account.getInformation(testAccount.addr)).balance)

    await client.send.claimWinnings({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee:AlgoAmount.MicroAlgo(3000)
    })

    const p1BalanceAfter = (await algorand.account.getInformation(testAccount.addr)).balance
    
    expect(p1BalanceAfter.valueOf()).toBeGreaterThan(p1BalanceBefore)
  }, 60_000)

  test('Case 2: Fail - Attempt to claim timeout BEFORE reveal phase ends', async () => {
    const { testAccount, algorand, algod } = localnet.context
    const { client } = await deploy(testAccount)
    
    const fee = 1_000_000
    const params = await createGameParams(0, 5, 50, fee)
    
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    const createRes = await client.send.createSession({
        args: { config: params, mbrPayment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(newGameMbr) }) },
        sender: testAccount.addr,
    })
    const sessionId = createRes.return!
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
    
    await waitForRound(params.startAt, client, algod)
    
    await client.send.joinSession({
       args: { sessionId, commit: getHash(0, 's1'), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(fee) }), mbrPayment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(joinMbr) }) },
       sender: testAccount.addr
    })
    const player2 = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.Algos(5))
    await client.send.joinSession({
       args: { sessionId, commit: getHash(1, 's2'), payment: await algorand.createTransaction.payment({ sender: player2.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(fee) }), mbrPayment: await algorand.createTransaction.payment({ sender: player2.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(joinMbr) }) },
       sender: player2.addr, signer: player2.signer
    })

    await waitForRound(params.endCommitAt + 1n, client, algod)
    await client.send.revealMove({
        args: { sessionId, choice: 0, salt: Buffer.from('s1') },
        sender: testAccount.addr
    })

    await expect(
        client.send.claimWinnings({
            args: { sessionId },
            sender: testAccount.addr
        })
    ).rejects.toThrow() 
  }, 60_000)

})

})
