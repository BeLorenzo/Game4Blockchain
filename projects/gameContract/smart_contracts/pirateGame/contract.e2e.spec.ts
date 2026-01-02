/* eslint-disable @typescript-eslint/no-explicit-any */
import { Config } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account } from 'algosdk'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { PirateGameFactory } from '../artifacts/pirateGame/PirateGameClient'

describe('PirateGame Contract - Complete Test Suite', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({ debug: true })
  })

  beforeEach(localnet.newScope)

  const deploy = async (account: Account & TransactionSignerAccount) => {
    const factory = localnet.algorand.client.getTypedAppFactory(PirateGameFactory, {
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

  const createGameParams = async (registrationDuration: number, roundDuration: number, participation: number) => {
    const now = (await localnet.context.algod.status().do()).lastRound
    const start = now + BigInt(registrationDuration)
    
    return {
      startAt: start,
      endCommitAt: start + 10n, // Not used in PirateGame
      endRevealAt: start + 20n, // Not used in PirateGame
      participation: BigInt(participation),
    }
  }

  const getHash = (choice: number, salt: string) => {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return crypto
      .createHash('sha256')
      .update(Buffer.concat([b, Buffer.from(salt)]))
      .digest()
  }

  const waitForRound = async (targetRound: bigint, client: any) => {
      const algod = localnet.context.algod
      while ((await algod.status().do()).lastRound < targetRound) {
         await client.send.getRequiredMbr({ args: { command: 'join' } }) 
      }
  }

  describe('Session Creation & MBR', () => {
    test('Creates session with correct MBR calculation', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 10, 10_000_000)
      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

      // Verify MBR calculation
      const expectedMBR = 2500 + 400 * (11 + 72) + // gameState
                         2500 + 400 * (11 + 640) + // pirateList
                         2500 + 400 * (11 + 184) + // proposals
                         2500 + 400 * (10 + 64) +  // parent: gameSessions
                         2500 + 400 * (12 + 8)      // parent: sessionBalances

      expect(Number(mbrAmount)).toBe(expectedMBR)

      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(Number(mbrAmount)),
      })

      const result = await client.send.createSession({
        args: {
          config: params,
          mbrPayment,
          maxPirates: 20n,
          roundDuration: 10n,
        },
        sender: testAccount.addr,
      })

      expect(result.return).toBeDefined()
      expect(Number(result.return)).toBeGreaterThanOrEqual(0)
    })

    test('Fails if maxPirates is too low', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const params = await createGameParams(5, 10, 10_000_000)
      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

      await expect(
        client.send.createSession({
          args: {
            config: params,
            mbrPayment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(mbrAmount)),
            }),
            maxPirates: 2n, // Too low
            roundDuration: 10n,
          },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Pirates must be between 3 and 20')
    })

    test('Fails if participation fee is too low', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      const params = await createGameParams(5, 10, 500_000) // < 1 ALGO
      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

      await expect(
        client.send.createSession({
          args: {
            config: params,
            mbrPayment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(mbrAmount)),
            }),
            maxPirates: 5n,
            roundDuration: 10n,
          },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Minimum participation is 1 ALGO')
    })
  })

  describe('Pirate Registration & MBR', () => {
    test('Pirates register successfully with correct MBR', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 10, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 10n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!
expect(Number(joinMbr)).toBe(2500 + 400 * (35 + 42))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: testAccount.addr,
      })

      // Verify registration
      const state = await client.state.box.gameState.value(sessionId)
      expect(state?.totalPirates).toBe(1n)
      expect(state?.pot).toBe(10_000_000n)
    }, 30000)

    test('Fails registration without MBR payment', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 10, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 10n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      await expect(
        client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(1000), // Too low
            }),
          },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Insufficient MBR')
    }, 30000)

    test('Prevents double registration', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 10, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 10n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      // First registration
      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: testAccount.addr,
      })

      // Second registration attempt
      await expect(
        client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: testAccount.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Already registered')
    }, 30000)
  })

  describe('Game Flow - Proposal & Voting', () => {
    test('Complete 3-pirate game', async () => {
  const { testAccount, algorand } = localnet.context
  const { client } = await deploy(testAccount)
  await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

  const params = await createGameParams(5, 30, 10_000_000)
  const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
  
  const sessionId = (await client.send.createSession({
    args: {
      config: params,
      mbrPayment: await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
      }),
      maxPirates: 5n,
      roundDuration: 30n,
    },
    sender: testAccount.addr,
  })).return!

  await waitForRound(params.startAt, client)

  // Register 3 pirates
  const pirates = []
  const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

  for (let i = 0; i < 3; i++) {
    const pirate = i === 0 ? testAccount : algorand.account.random()
    if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

    await client.send.registerPirate({
      args: {
        sessionId,
        payment: await algorand.createTransaction.payment({
          sender: pirate.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(10_000_000),
        }),
        mbrPayment: await algorand.createTransaction.payment({
          sender: pirate.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
        }),
      },
      sender: pirate.addr,
      signer: pirate.signer,
    })
    pirates.push(pirate)
  }

  // Wait for registration to close and start game
  const state1 = await client.state.box.gameState.value(sessionId)
  await waitForRound(state1!.proposalDeadline + 1n, client)

  await client.send.startGame({
    args: { sessionId },
    sender: testAccount.addr,
  })

  const distribution = Buffer.alloc(24) 
  distribution.writeBigUInt64BE(29_000_000n, 0)  // Pirate 0
  distribution.writeBigUInt64BE(0n, 8)           // Pirate 1
  distribution.writeBigUInt64BE(1_000_000n, 16)  // Pirate 2

  await client.send.proposeDistribution({
    args: { sessionId, distribution },
    sender: pirates[0].addr,
    signer: pirates[0].signer,
    coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
  })

  // Pirates commit votes
  const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!
  
  // Pirate0: YES
  await client.send.commitVote({
    args: {
      sessionId,
      voteHash: new Uint8Array(getHash(1, 'salt0')),
      mbrPayment: await algorand.createTransaction.payment({
        sender: pirates[0].addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
      }),
    },
    sender: pirates[0].addr,
    signer: pirates[0].signer,
    coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
  })

  // Pirate1: NO
  await client.send.commitVote({
    args: {
      sessionId,
      voteHash: new Uint8Array(getHash(0, 'salt1')),
      mbrPayment: await algorand.createTransaction.payment({
        sender: pirates[1].addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
      }),
    },
    sender: pirates[1].addr,
    signer: pirates[1].signer,
    coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
  })

  // Pirate2: YES
  await client.send.commitVote({
    args: {
      sessionId,
      voteHash: new Uint8Array(getHash(1, 'salt2')),
      mbrPayment: await algorand.createTransaction.payment({
        sender: pirates[2].addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
      }),
    },
    sender: pirates[2].addr,
    signer: pirates[2].signer,
    coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
  })

  // Wait for vote deadline and reveal
  const state2 = await client.state.box.gameState.value(sessionId)
  await waitForRound(state2!.voteDeadline + 1n, client)

  await client.send.revealVote({
    args: { sessionId, vote: 1n, salt: Buffer.from('salt0') },
    sender: pirates[0].addr,
    signer: pirates[0].signer,
  })

  await client.send.revealVote({
    args: { sessionId, vote: 0n, salt: Buffer.from('salt1') },
    sender: pirates[1].addr,
    signer: pirates[1].signer,
  })

  await client.send.revealVote({
    args: { sessionId, vote: 1n, salt: Buffer.from('salt2') },
    sender: pirates[2].addr,
    signer: pirates[2].signer,
  })

  // Wait for reveal deadline and execute
  const state3 = await client.state.box.gameState.value(sessionId)
  await waitForRound(state3!.revealDeadline + 1n, client)

  await client.send.executeRound({
    args: { sessionId },
    sender: testAccount.addr,
    coverAppCallInnerTransactionFees: true, 
    maxFee: AlgoAmount.MicroAlgo(3000),
  })

  // Verify game ended
  const finalState = await client.state.box.gameState.value(sessionId)
  expect(finalState?.phase).toBe(4n) 

  // Claim winnings
  const claim0 = await client.send.claimWinnings({
    args: { sessionId },
    sender: pirates[0].addr,
    signer: pirates[0].signer,
    coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
  })
  expect(claim0.return).toBe(29_000_000n)

  const claim2 = await client.send.claimWinnings({
    args: { sessionId },
    sender: pirates[2].addr,
    signer: pirates[2].signer,
    coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
  })
  expect(claim2.return).toBe(1_000_000n)

  // Pirate1 gets nothing
  await expect(
    client.send.claimWinnings({
      args: { sessionId },
      sender: pirates[1].addr,
      signer: pirates[1].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })
  ).rejects.toThrow('No winnings')
}, 60000)

    test('Proposal fails, proposer eliminated, next round', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      // Register 4 pirates
      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 4; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await client.send.startGame({
        args: { sessionId },
        sender: testAccount.addr,
      })

      // Greedy proposal: [40M, 0, 0, 0] 
      const distribution = Buffer.alloc(32)
      distribution.writeBigUInt64BE(40_000_000n, 0)

      await client.send.proposeDistribution({
        args: { sessionId, distribution },
        sender: pirates[0].addr,
        signer: pirates[0].signer,
        coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
      })

      // All vote NO
      const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!
      
      for (let i = 0; i < 4; i++) {
        await client.send.commitVote({
          args: {
            sessionId,
            voteHash: new Uint8Array(getHash(0, `salt${i}`)),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirates[i].addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
            }),
          },
          sender: pirates[i].addr,
          signer: pirates[i].signer,
        })
      }

      const state2 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state2!.voteDeadline + 1n, client)

      for (let i = 0; i < 4; i++) {
        await client.send.revealVote({
          args: { sessionId, vote: 0n, salt: Buffer.from(`salt${i}`) },
          sender: pirates[i].addr,
          signer: pirates[i].signer,
        })
      }

      const state3 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state3!.revealDeadline + 1n, client)

      await client.send.executeRound({
        args: { sessionId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
      })

      // Verify Pirate0 eliminated and round advanced
      const newState = await client.state.box.gameState.value(sessionId)
      expect(newState?.phase).toBe(1n) // Back to proposal
      expect(newState?.currentRound).toBe(1n)
      expect(newState?.alivePirates).toBe(3n)
      expect(newState?.currentProposerIndex).toBe(1n) // Next pirate
    }, 60000)
  })

  describe('TimeOut Functionality', () => {
    test('Eliminates AFK proposer via timeout', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      // Register 3 pirates
      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 3; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await client.send.startGame({
        args: { sessionId },
        sender: testAccount.addr,
      })

      // Pirate0 doesn't propose - wait for timeout
      const state2 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state2!.proposalDeadline + 1n, client)

      // Anyone can call timeout
      await client.send.timeOut({
        args: { sessionId },
        sender: pirates[1].addr, // Not the proposer
        signer: pirates[1].signer,
        coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
      })

      // Verify Pirate0 eliminated
      const newState = await client.state.box.gameState.value(sessionId)
      expect(newState?.alivePirates).toBe(2n)
      expect(newState?.currentProposerIndex).toBe(1n) // Next pirate
      expect(newState?.phase).toBe(1n) // Still in proposal phase
    }, 60000)

    test('Timeout gives last pirate auto-win', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      // Register only 2 pirates
      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 2; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await expect(
        client.send.startGame({
          args: { sessionId },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Need at least 3 pirates')
    }, 60000)

    test('Cannot call timeout before deadline', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 3; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await client.send.startGame({
        args: { sessionId },
        sender: testAccount.addr,
      })

      // Try timeout BEFORE deadline
      await expect(
        client.send.timeOut({
          args: { sessionId },
          sender: testAccount.addr,
          coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
        })
      ).rejects.toThrow('Proposal deadline not passed yet')
    }, 60000)
  })

  describe('Edge Cases & Error Handling', () => {
    test('Cannot reveal with wrong salt', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 3; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

      const distribution = Buffer.alloc(24)
      distribution.writeBigUInt64BE(29_000_000n, 0)
      distribution.writeBigUInt64BE(0n, 8)
      distribution.writeBigUInt64BE(1_000_000n, 16)

      await client.send.proposeDistribution({
        args: { sessionId, distribution },
        sender: pirates[0].addr,
        signer: pirates[0].signer,
        coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
      })

      const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(1, 'correct_salt')),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[0].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[0].addr,
        signer: pirates[0].signer,
      })

      const state2 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state2!.voteDeadline + 1n, client)

      // Try to reveal with WRONG salt
      await expect(
        client.send.revealVote({
          args: { sessionId, vote: 1n, salt: Buffer.from('wrong_salt') },
          sender: pirates[0].addr,
          signer: pirates[0].signer,
        })
      ).rejects.toThrow('Invalid reveal: hash mismatch')
    }, 60000)

    test('Cannot propose if not your turn', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 3; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

      const distribution = Buffer.alloc(24)
      distribution.writeBigUInt64BE(20_000_000n, 0)
      distribution.writeBigUInt64BE(5_000_000n, 8)
      distribution.writeBigUInt64BE(5_000_000n, 16)

      // Pirate1 tries to propose when it's Pirate0's turn
      await expect(
        client.send.proposeDistribution({
          args: { sessionId, distribution },
          sender: pirates[1].addr,
          signer: pirates[1].signer,
          coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
        })
      ).rejects.toThrow('Not your turn to propose')
    }, 60000)

    test('Distribution must sum to pot', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 3; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

      // Distribution that doesn't sum to 30M
      const distribution = Buffer.alloc(24)
      distribution.writeBigUInt64BE(20_000_000n, 0)
      distribution.writeBigUInt64BE(5_000_000n, 8)
      distribution.writeBigUInt64BE(3_000_000n, 16) // Total: 28M != 30M

      await expect(
        client.send.proposeDistribution({
          args: { sessionId, distribution },
          sender: pirates[0].addr,
          signer: pirates[0].signer,
          coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
        })
      ).rejects.toThrow('Distribution must sum to pot')
    }, 60000)

    test('Cannot double claim winnings', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      const params = await createGameParams(5, 30, 10_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      
      const sessionId = (await client.send.createSession({
        args: {
          config: params,
          mbrPayment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
          }),
          maxPirates: 5n,
          roundDuration: 30n,
        },
        sender: testAccount.addr,
      })).return!

      await waitForRound(params.startAt, client)

      const pirates = []
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

      for (let i = 0; i < 3; i++) {
        const pirate = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

        await client.send.registerPirate({
          args: {
            sessionId,
            payment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(10_000_000),
            }),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirate.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
            }),
          },
          sender: pirate.addr,
          signer: pirate.signer,
        })
        pirates.push(pirate)
      }

      const state1 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state1!.proposalDeadline + 1n, client)

      await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

      const distribution = Buffer.alloc(24)
      distribution.writeBigUInt64BE(29_000_000n, 0)
      distribution.writeBigUInt64BE(0n, 8)
      distribution.writeBigUInt64BE(1_000_000n, 16)

      await client.send.proposeDistribution({
        args: { sessionId, distribution },
        sender: pirates[0].addr,
        signer: pirates[0].signer,
        coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
      })

      const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

      for (let i = 0; i < 3; i++) {
        await client.send.commitVote({
          args: {
            sessionId,
            voteHash: new Uint8Array(getHash(1, `salt${i}`)),
            mbrPayment: await algorand.createTransaction.payment({
              sender: pirates[i].addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
            }),
          },
          sender: pirates[i].addr,
          signer: pirates[i].signer,
        })
      }

      const state2 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state2!.voteDeadline + 1n, client)

      for (let i = 0; i < 3; i++) {
        await client.send.revealVote({
          args: { sessionId, vote: 1n, salt: Buffer.from(`salt${i}`) },
          sender: pirates[i].addr,
          signer: pirates[i].signer,
        })
      }

      const state3 = await client.state.box.gameState.value(sessionId)
      await waitForRound(state3!.revealDeadline + 1n, client)

      await client.send.executeRound({
        args: { sessionId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
      })

      // First claim
      await client.send.claimWinnings({
        args: { sessionId },
        sender: pirates[0].addr,
        signer: pirates[0].signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })

      // Second claim attempt
      await expect(
        client.send.claimWinnings({
          args: { sessionId },
          sender: pirates[0].addr,
          signer: pirates[0].signer,
          coverAppCallInnerTransactionFees: true,
    maxFee: AlgoAmount.MicroAlgo(3000),
        })
      ).rejects.toThrow('Already claimed')
    }, 60000)
  })

  test('5 pirates, 3 YES (60%) → proposal PASSES', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

    const params = await createGameParams(5, 30, 10_000_000)
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    
    const sessionId = (await client.send.createSession({
      args: {
        config: params,
        mbrPayment: await algorand.createTransaction.payment({
          sender: testAccount.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
        }),
        maxPirates: 5n,
        roundDuration: 30n,
      },
      sender: testAccount.addr,
    })).return!

    await waitForRound(params.startAt, client)

    // Register 5 pirates
    const pirates = []
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < 5; i++) {
      const pirate = i === 0 ? testAccount : algorand.account.random()
      if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: pirate.addr,
        signer: pirate.signer,
      })
      pirates.push(pirate)
    }

    const state1 = await client.state.box.gameState.value(sessionId)
    await waitForRound(state1!.proposalDeadline + 1n, client)

    await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

    // Strategic proposal: [45M, 1M, 1M, 1M, 2M]
    const distribution = Buffer.alloc(40)
    distribution.writeBigUInt64BE(45_000_000n, 0)  // Pirate 0
    distribution.writeBigUInt64BE(1_000_000n, 8)   // Pirate 1
    distribution.writeBigUInt64BE(1_000_000n, 16)  // Pirate 2
    distribution.writeBigUInt64BE(1_000_000n, 24)  // Pirate 3
    distribution.writeBigUInt64BE(2_000_000n, 32)  // Pirate 4

    await client.send.proposeDistribution({
      args: { sessionId, distribution },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

    const votes = [1, 0, 1, 0, 1] // YES, NO, YES, NO, YES

    for (let i = 0; i < 5; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(votes[i], `salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    const state2 = await client.state.box.gameState.value(sessionId)
    await waitForRound(state2!.voteDeadline + 1n, client)

    for (let i = 0; i < 5; i++) {
      await client.send.revealVote({
        args: { sessionId, vote: BigInt(votes[i]), salt: Buffer.from(`salt${i}`) },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    const state3 = await client.state.box.gameState.value(sessionId)
    await waitForRound(state3!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // VERIFY: Threshold = (5+1)/2 = 3, votesFor = 3 → PASSES
    const finalState = await client.state.box.gameState.value(sessionId)
    expect(finalState?.phase).toBe(4n) // Finished

    // Winners claim
    const claim0 = await client.send.claimWinnings({
      args: { sessionId },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })
    expect(claim0.return).toBe(45_000_000n)

    const claim4 = await client.send.claimWinnings({
      args: { sessionId },
      sender: pirates[4].addr,
      signer: pirates[4].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })
    expect(claim4.return).toBe(2_000_000n)

const claim1 = await client.send.claimWinnings({
      args: { sessionId },
      sender: pirates[1].addr, // Pirate 1
      signer: pirates[1].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })
    expect(claim1.return).toBe(1_000_000n)
  }, 90000)

  test('5 pirates, 2 YES (40%) → proposal FAILS', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

    const params = await createGameParams(5, 30, 10_000_000)
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    
    const sessionId = (await client.send.createSession({
      args: {
        config: params,
        mbrPayment: await algorand.createTransaction.payment({
          sender: testAccount.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
        }),
        maxPirates: 5n,
        roundDuration: 30n,
      },
      sender: testAccount.addr,
    })).return!

    await waitForRound(params.startAt, client)

    const pirates = []
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < 5; i++) {
      const pirate = i === 0 ? testAccount : algorand.account.random()
      if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: pirate.addr,
        signer: pirate.signer,
      })
      pirates.push(pirate)
    }

    const state1 = await client.state.box.gameState.value(sessionId)
    await waitForRound(state1!.proposalDeadline + 1n, client)

    await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

    // Greedy proposal: [50M, 0, 0, 0, 0]
    const distribution = Buffer.alloc(40)
    distribution.writeBigUInt64BE(50_000_000n, 0)

    await client.send.proposeDistribution({
      args: { sessionId, distribution },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

    const votes = [1, 1, 0, 0, 0]

    for (let i = 0; i < 5; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(votes[i], `salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    const state2 = await client.state.box.gameState.value(sessionId)
    await waitForRound(state2!.voteDeadline + 1n, client)

    for (let i = 0; i < 5; i++) {
      await client.send.revealVote({
        args: { sessionId, vote: BigInt(votes[i]), salt: Buffer.from(`salt${i}`) },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    const state3 = await client.state.box.gameState.value(sessionId)
    await waitForRound(state3!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // VERIFY: Threshold = (5+1)/2 = 3, votesFor = 2 → FAILS
    const newState = await client.state.box.gameState.value(sessionId)
    expect(newState?.phase).toBe(1n) // Back to proposal
    expect(newState?.currentRound).toBe(1n)
    expect(newState?.alivePirates).toBe(4n)
    expect(newState?.currentProposerIndex).toBe(1n) // Pirate0 eliminated
  }, 90000)

  test('5 pirates → 3 eliminations → final round', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(150))

    const params = await createGameParams(5, 50, 10_000_000)
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    
    const sessionId = (await client.send.createSession({
      args: {
        config: params,
        mbrPayment: await algorand.createTransaction.payment({
          sender: testAccount.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
        }),
        maxPirates: 5n,
        roundDuration: 50n,
      },
      sender: testAccount.addr,
    })).return!

    await waitForRound(params.startAt, client)

    const pirates = []
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < 5; i++) {
      const pirate = i === 0 ? testAccount : algorand.account.random()
      if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(25))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: pirate.addr,
        signer: pirate.signer,
      })
      pirates.push(pirate)
    }

    let state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.proposalDeadline + 1n, client)

    await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

    const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

    state = await client.state.box.gameState.value(sessionId)
    
    const dist0 = Buffer.alloc(40)
    dist0.writeBigUInt64BE(50_000_000n, 0)

    await client.send.proposeDistribution({
      args: { sessionId, distribution: dist0 },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // All vote NO
    for (let i = 0; i < 5; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(0, `r0_salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.voteDeadline + 1n, client)

    for (let i = 0; i < 5; i++) {
      await client.send.revealVote({
        args: { sessionId, vote: 0n, salt: Buffer.from(`r0_salt${i}`) },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Verify round 1, 4 alive
    state = await client.state.box.gameState.value(sessionId)
    expect(state?.currentRound).toBe(1n)
    expect(state?.alivePirates).toBe(4n)

    const dist1 = Buffer.alloc(40)
    dist1.writeBigUInt64BE(0n, 0)
    dist1.writeBigUInt64BE(50_000_000n, 8)

    await client.send.proposeDistribution({
      args: { sessionId, distribution: dist1 },
      sender: pirates[1].addr,
      signer: pirates[1].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Alive pirates vote (1, 2, 3, 4)
    for (let i = 1; i < 5; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(0, `r1_salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.voteDeadline + 1n, client)

    for (let i = 1; i < 5; i++) {
      await client.send.revealVote({
        args: { sessionId, vote: 0n, salt: Buffer.from(`r1_salt${i}`) },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Verify round 2, 3 alive
    state = await client.state.box.gameState.value(sessionId)
    expect(state?.currentRound).toBe(2n)
    expect(state?.alivePirates).toBe(3n)

    const dist2 = Buffer.alloc(40)
    dist2.writeBigUInt64BE(0n, 0)
    dist2.writeBigUInt64BE(0n, 8)
    dist2.writeBigUInt64BE(50_000_000n, 16)

    await client.send.proposeDistribution({
      args: { sessionId, distribution: dist2 },
      sender: pirates[2].addr,
      signer: pirates[2].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Alive: 2, 3, 4
    for (let i = 2; i < 5; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(0, `r2_salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.voteDeadline + 1n, client)

    for (let i = 2; i < 5; i++) {
      await client.send.revealVote({
        args: { sessionId, vote: 0n, salt: Buffer.from(`r2_salt${i}`) },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Verify round 3, 2 alive (3, 4)
    state = await client.state.box.gameState.value(sessionId)
    expect(state?.currentRound).toBe(3n)
    expect(state?.alivePirates).toBe(2n)

    const dist3 = Buffer.alloc(40)
    dist3.writeBigUInt64BE(0n, 0)
    dist3.writeBigUInt64BE(0n, 8)
    dist3.writeBigUInt64BE(0n, 16)
    dist3.writeBigUInt64BE(49_000_000n, 24)
    dist3.writeBigUInt64BE(1_000_000n, 32)

    await client.send.proposeDistribution({
      args: { sessionId, distribution: dist3 },
      sender: pirates[3].addr,
      signer: pirates[3].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Pirate3: YES, Pirate4: YES
    await client.send.commitVote({
      args: {
        sessionId,
        voteHash: new Uint8Array(getHash(1, 'r3_salt3')),
        mbrPayment: await algorand.createTransaction.payment({
          sender: pirates[3].addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
        }),
      },
      sender: pirates[3].addr,
      signer: pirates[3].signer,
    })

    await client.send.commitVote({
      args: {
        sessionId,
        voteHash: new Uint8Array(getHash(1, 'r3_salt4')),
        mbrPayment: await algorand.createTransaction.payment({
          sender: pirates[4].addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
        }),
      },
      sender: pirates[4].addr,
      signer: pirates[4].signer,
    })

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.voteDeadline + 1n, client)

    await client.send.revealVote({
      args: { sessionId, vote: 1n, salt: Buffer.from('r3_salt3') },
      sender: pirates[3].addr,
      signer: pirates[3].signer,
    })

    await client.send.revealVote({
      args: { sessionId, vote: 1n, salt: Buffer.from('r3_salt4') },
      sender: pirates[4].addr,
      signer: pirates[4].signer,
    })

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // VERIFY: Game finished
    const finalState = await client.state.box.gameState.value(sessionId)
    expect(finalState?.phase).toBe(4n)

    // Winners claim
    const claim3 = await client.send.claimWinnings({
      args: { sessionId },
      sender: pirates[3].addr,
      signer: pirates[3].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })
    expect(claim3.return).toBe(49_000_000n)

    const claim4 = await client.send.claimWinnings({
      args: { sessionId },
      sender: pirates[4].addr,
      signer: pirates[4].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })
    expect(claim4.return).toBe(1_000_000n)
  }, 180000) // 3 minutes

  test('Eliminated pirate cannot vote in next round', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

    const params = await createGameParams(5, 30, 10_000_000)
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    
    const sessionId = (await client.send.createSession({
      args: {
        config: params,
        mbrPayment: await algorand.createTransaction.payment({
          sender: testAccount.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
        }),
        maxPirates: 5n,
        roundDuration: 30n,
      },
      sender: testAccount.addr,
    })).return!

    await waitForRound(params.startAt, client)

    const pirates = []
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < 4; i++) {
      const pirate = i === 0 ? testAccount : algorand.account.random()
      if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: pirate.addr,
        signer: pirate.signer,
      })
      pirates.push(pirate)
    }

    let state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.proposalDeadline + 1n, client)

    await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

    // Round 0: Eliminate Pirate0
    const dist0 = Buffer.alloc(32)
    dist0.writeBigUInt64BE(40_000_000n, 0)

    await client.send.proposeDistribution({
      args: { sessionId, distribution: dist0 },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

    for (let i = 0; i < 4; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(0, `salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.voteDeadline + 1n, client)

    for (let i = 0; i < 4; i++) {
      await client.send.revealVote({
        args: { sessionId, vote: 0n, salt: Buffer.from(`salt${i}`) },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Round 1: Pirate0 tries to vote (MUST FAIL)
    const dist1 = Buffer.alloc(32)
    dist1.writeBigUInt64BE(0n, 0)
    dist1.writeBigUInt64BE(40_000_000n, 8)

    await client.send.proposeDistribution({
      args: { sessionId, distribution: dist1 },
      sender: pirates[1].addr,
      signer: pirates[1].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Pirate0 (DEAD) tries to vote
    await expect(
      client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(1, 'dead_vote')),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[0].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[0].addr,
        signer: pirates[0].signer,
      })
    ).rejects.toThrow('You are eliminated')
  }, 90000)

  test('Only 1 of 3 pirates reveals → implicit NO votes', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

    const params = await createGameParams(5, 30, 10_000_000)
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    
    const sessionId = (await client.send.createSession({
      args: {
        config: params,
        mbrPayment: await algorand.createTransaction.payment({
          sender: testAccount.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
        }),
        maxPirates: 5n,
        roundDuration: 30n,
      },
      sender: testAccount.addr,
    })).return!

    await waitForRound(params.startAt, client)

    const pirates = []
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < 3; i++) {
      const pirate = i === 0 ? testAccount : algorand.account.random()
      if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: pirate.addr,
        signer: pirate.signer,
      })
      pirates.push(pirate)
    }

    let state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.proposalDeadline + 1n, client)

    await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

    const distribution = Buffer.alloc(24)
    distribution.writeBigUInt64BE(30_000_000n, 0)

    await client.send.proposeDistribution({
      args: { sessionId, distribution },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

    // All 3 commit
    for (let i = 0; i < 3; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(1, `salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.voteDeadline + 1n, client)

    // ONLY Pirate0 reveals (vote YES)
    await client.send.revealVote({
      args: { sessionId, vote: 1n, salt: Buffer.from('salt0') },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
    })

    // Pirate1 and Pirate2 don't reveal (implicit NO)

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    const newState = await client.state.box.gameState.value(sessionId)
    expect(newState?.phase).toBe(1n) // Back to proposal
    expect(newState?.currentRound).toBe(1n)
    expect(newState?.alivePirates).toBe(2n) // Pirate0 eliminated
  }, 90000)

  test('Cannot vote after vote deadline', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

    const params = await createGameParams(5, 30, 10_000_000)
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    
    const sessionId = (await client.send.createSession({
      args: {
        config: params,
        mbrPayment: await algorand.createTransaction.payment({
          sender: testAccount.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
        }),
        maxPirates: 5n,
        roundDuration: 30n,
      },
      sender: testAccount.addr,
    })).return!

    await waitForRound(params.startAt, client)

    const pirates = []
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < 3; i++) {
      const pirate = i === 0 ? testAccount : algorand.account.random()
      if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: pirate.addr,
        signer: pirate.signer,
      })
      pirates.push(pirate)
    }

    let state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.proposalDeadline + 1n, client)

    await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

    const distribution = Buffer.alloc(24)
    distribution.writeBigUInt64BE(20_000_000n, 0)
    distribution.writeBigUInt64BE(5_000_000n, 8)
    distribution.writeBigUInt64BE(5_000_000n, 16)

    await client.send.proposeDistribution({
      args: { sessionId, distribution },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    state = await client.state.box.gameState.value(sessionId)
    
    // Wait PAST vote deadline
    await waitForRound(state!.voteDeadline + 1n, client)

    // Try to vote AFTER deadline
    const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

    await expect(
      client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(1, 'late_vote')),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[1].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[1].addr,
        signer: pirates[1].signer,
      })
    ).rejects.toThrow('Voting deadline passed')
  }, 90000)

  test('Non-pirate cannot claim winnings', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

    const params = await createGameParams(5, 30, 10_000_000)
    const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
    
    const sessionId = (await client.send.createSession({
      args: {
        config: params,
        mbrPayment: await algorand.createTransaction.payment({
          sender: testAccount.addr,
          receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos(Number(newGameMbr)),
        }),
        maxPirates: 5n,
        roundDuration: 30n,
      },
      sender: testAccount.addr,
    })).return!

    await waitForRound(params.startAt, client)

    const pirates = []
    const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < 3; i++) {
      const pirate = i === 0 ? testAccount : algorand.account.random()
      if (i !== 0) await algorand.account.ensureFundedFromEnvironment(pirate, AlgoAmount.Algos(20))

      await client.send.registerPirate({
        args: {
          sessionId,
          payment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(10_000_000),
          }),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirate.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: pirate.addr,
        signer: pirate.signer,
      })
      pirates.push(pirate)
    }

    let state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.proposalDeadline + 1n, client)

    await client.send.startGame({ args: { sessionId }, sender: testAccount.addr })

    const distribution = Buffer.alloc(24)
    distribution.writeBigUInt64BE(29_000_000n, 0)
    distribution.writeBigUInt64BE(0n, 8)
    distribution.writeBigUInt64BE(1_000_000n, 16)

    await client.send.proposeDistribution({
      args: { sessionId, distribution },
      sender: pirates[0].addr,
      signer: pirates[0].signer,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

    for (let i = 0; i < 3; i++) {
      await client.send.commitVote({
        args: {
          sessionId,
          voteHash: new Uint8Array(getHash(1, `salt${i}`)),
          mbrPayment: await algorand.createTransaction.payment({
            sender: pirates[i].addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.voteDeadline + 1n, client)

    for (let i = 0; i < 3; i++) {
      await client.send.revealVote({
        args: { sessionId, vote: 1n, salt: Buffer.from(`salt${i}`) },
        sender: pirates[i].addr,
        signer: pirates[i].signer,
      })
    }

    state = await client.state.box.gameState.value(sessionId)
    await waitForRound(state!.revealDeadline + 1n, client)

    await client.send.executeRound({
      args: { sessionId },
      sender: testAccount.addr,
      coverAppCallInnerTransactionFees: true,
      maxFee: AlgoAmount.MicroAlgo(3000),
    })

    // Random intruder tries to claim
    const intruder = algorand.account.random()
    await algorand.account.ensureFundedFromEnvironment(intruder, AlgoAmount.Algos(5))

    await expect(
      client.send.claimWinnings({
        args: { sessionId },
        sender: intruder.addr,
        signer: intruder.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      })
    ).rejects.toThrow('Not a pirate')
  }, 90000)
})
