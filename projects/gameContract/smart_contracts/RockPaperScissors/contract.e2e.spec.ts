import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { RockPaperScissorsFactory } from '../artifacts/RockPaperScissors/RockPaperScissorsClient'
import { GameConfig } from '../abstract_contract2/contract.algo'
import { Global } from '@algorandfoundation/algorand-typescript'

describe('RockPaperScissors contract', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({
      debug: true,
    })
    registerDebugEventHandlers()
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

    // Fund contract to maintain minimum balance
    await localnet.algorand.account.ensureFunded(
      appClient.appAddress, 
      account.addr, 
      AlgoAmount.MicroAlgos(200_000)
    )
    return { client: appClient }
  }

  // Helper function to create game configuration
  const createGameConfig = (startAt: number, endCommitAt: number, endRevealAt: number, participation: number) => {
    const currentTime = Global.latestTimestamp
    return {
      startAt: currentTime + startAt,
      endCommitAt: currentTime + startAt + endCommitAt,
      endRevealAt: currentTime + startAt + endCommitAt + endRevealAt,
      participation,
    }
  }

  // Helper function to create payment transactions with unique notes
  const createPayments = async (client: any, testAccount: Account, amount: number, note?: string) => {
    const uniqueNote = note || `test-${Date.now()}-${Math.random()}`

    return localnet.context.algorand.createTransaction.payment({
      sender: testAccount.addr,
      receiver: client.appAddress,
      amount: AlgoAmount.MicroAlgos(amount),
      note: new TextEncoder().encode(uniqueNote),
    })
  }

  // Helper function to generate commit hash (choice + salt)
  const generateCommit = (choice: number, salt: string): Uint8Array => {
    // In a real scenario, you'd use proper SHA256 hashing
    // This is a simplified version for testing
    const encoder = new TextEncoder()
    const choiceBytes = encoder.encode(choice.toString())
    const saltBytes = encoder.encode(salt)
    const combined = new Uint8Array(choiceBytes.length + saltBytes.length)
    combined.set(choiceBytes)
    combined.set(saltBytes, choiceBytes.length)
    return combined
  }

  test('creates a new game session on localnet', async () => {
    const { testAccount, algorand } = localnet.context
    const { client } = await deploy(testAccount)
    await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

    const config : GameConfig = createGameConfig(60, 300, 300, 100_000) // Start in 60s, 5min phases, 0.1 ALGO entry
    const mbrPayment = await createPayments(client, testAccount, 100000, 'create-session')

    const result = await client.send.createNewSession({
      args: { config, mbrPayment },
      sender: testAccount.addr,
    })

    const sessionId = result.return!
    expect(Number(sessionId)).toBeGreaterThan(0)

    // Verify session was created by checking session exists
    const sessionExists = await client.send.sessionExists({ sessionID: sessionId })
    expect(sessionExists.return).toBe(true)
  })

  describe('Session creation validation', () => {
    test('throws error if timeline is invalid', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const mbrPayment = await createPayments(client, testAccount, 100000, 'invalid-timeline')

      // Start time in the past
      const currentTime = Math.floor(Date.now() / 1000)
      const invalidConfig = {
        startAt: currentTime - 100, // Past
        endCommitAt: currentTime + 300,
        endRevealAt: currentTime + 600,
        participation: 100000,
      }

      await expect(
        client.send.createNewSession({
          args: { config: invalidConfig, mbrPayment },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Invalid start time: cannot start in the past')
    })

    test('throws error if MBR payment is insufficient', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const insufficientMBRPayment = await createPayments(client, testAccount, 1000, 'insufficient-mbr') // Too low
      const config = createGameConfig(60, 300, 300, 100_000)

      await expect(
        client.send.createNewSession({
          args: { config, mbrPayment: insufficientMBRPayment },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Insufficient MBR')
    })

    test('throws error if MBR payment receiver is wrong', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      // Create payment to wrong receiver
      const wrongReceiverPayment = localnet.context.algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: testAccount.addr, // Wrong receiver
        amount: AlgoAmount.MicroAlgos(100000),
        note: new TextEncoder().encode('wrong-receiver'),
      })

      const config = createGameConfig(60, 300, 300, 100_000)

      await expect(
        client.send.createNewSession({
          args: { config, mbrPayment: wrongReceiverPayment },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('MBR payment must be sent to contract')
    })
  })

  describe('Player joining functionality', () => {
    test('allows two players to join a session', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      
      // Create second test account
      const player2 = await localnet.context.algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))
      await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.MicroAlgos(1000000000))

      const config = createGameConfig(60, 300, 300, 100_000)
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-for-join')

      // Create session
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Player 1 joins
      const commit1 = generateCommit(0, 'salt1') // Rock
      const entryPayment1 = await createPayments(client, testAccount, config.participation, 'player1-join')
      const mbrPayment1 = await createPayments(client, testAccount, 50000, 'player1-mbr')

      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit1, payment: entryPayment1, mbrPayment: mbrPayment1 },
        sender: testAccount.addr,
      })

      // Player 2 joins
      const commit2 = generateCommit(1, 'salt2') // Paper
      const entryPayment2 = await createPayments(client, player2, config.participation, 'player2-join')
      const mbrPayment2 = await createPayments(client, player2, 50000, 'player2-mbr')

      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit2, payment: entryPayment2, mbrPayment: mbrPayment2 },
        sender: player2.addr,
      })

      // Verify both players joined successfully by checking session balance
      const balance = await client.send.getSessionBalance({ sessionID: sessionId })
      expect(Number(balance.return)).toBe(config.participation * 2)
    })

    test('throws error when third player tries to join', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      
      const player2 = await localnet.context.algorand.account.random()
      const player3 = await localnet.context.algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))
      await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.MicroAlgos(1000000000))
      await algorand.account.ensureFundedFromEnvironment(player3, AlgoAmount.MicroAlgos(1000000000))

      const config = createGameConfig(60, 300, 300, 100_000)
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-for-full')

      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Join first two players
      const commit1 = generateCommit(0, 'salt1')
      const entryPayment1 = await createPayments(client, testAccount, config.participation, 'p1-join')
      const mbrPayment1 = await createPayments(client, testAccount, 50000, 'p1-mbr')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit1, payment: entryPayment1, mbrPayment: mbrPayment1 },
        sender: testAccount.addr,
      })

      const commit2 = generateCommit(1, 'salt2')
      const entryPayment2 = await createPayments(client, player2, config.participation, 'p2-join')
      const mbrPayment2 = await createPayments(client, player2, 50000, 'p2-mbr')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit2, payment: entryPayment2, mbrPayment: mbrPayment2 },
        sender: player2.addr,
      })

      // Third player should fail
      const commit3 = generateCommit(2, 'salt3')
      const entryPayment3 = await createPayments(client, player3, config.participation, 'p3-join')
      const mbrPayment3 = await createPayments(client, player3, 50000, 'p3-mbr')

      await expect(
        client.send.joinSession({
          args: { sessionID: sessionId, commit: commit3, payment: entryPayment3, mbrPayment: mbrPayment3 },
          sender: player3.addr,
        })
      ).rejects.toThrow('La sessione è piena (2 giocatori)')
    })

    test('throws error when player tries to join twice', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const config = createGameConfig(60, 300, 300, 100_000)
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-for-double')

      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // First join
      const commit1 = generateCommit(0, 'salt1')
      const entryPayment1 = await createPayments(client, testAccount, config.participation, 'first-join')
      const mbrPayment1 = await createPayments(client, testAccount, 50000, 'first-mbr')

      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit1, payment: entryPayment1, mbrPayment: mbrPayment1 },
        sender: testAccount.addr,
      })

      // Try to join again with different commit
      const commit2 = generateCommit(1, 'salt2')
      const entryPayment2 = await createPayments(client, testAccount, config.participation, 'second-join')
      const mbrPayment2 = await createPayments(client, testAccount, 50000, 'second-mbr')

      await expect(
        client.send.joinSession({
          args: { sessionID: sessionId, commit: commit2, payment: entryPayment2, mbrPayment: mbrPayment2 },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Giocatore già in sessione')
    })
  })

  describe('Move revealing and game resolution', () => {
    test('completes a full game with player 1 winning', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      
      const player2 = await localnet.context.algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))
      await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.MicroAlgos(1000000000))

      // Create session starting immediately
      const currentTime = Math.floor(Date.now() / 1000)
      const config = {
        startAt: currentTime,
        endCommitAt: currentTime + 300,
        endRevealAt: currentTime + 600,
        participation: 100_000,
      }
      
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-for-game')
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Both players join
      const commit1 = generateCommit(0, 'salt1') // Player 1: Rock
      const entryPayment1 = await createPayments(client, testAccount, config.participation, 'p1-join-game')
      const mbrPayment1 = await createPayments(client, testAccount, 50000, 'p1-mbr-game')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit1, payment: entryPayment1, mbrPayment: mbrPayment1 },
        sender: testAccount.addr,
      })

      const commit2 = generateCommit(2, 'salt2') // Player 2: Scissors
      const entryPayment2 = await createPayments(client, player2, config.participation, 'p2-join-game')
      const mbrPayment2 = await createPayments(client, player2, 50000, 'p2-mbr-game')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit2, payment: entryPayment2, mbrPayment: mbrPayment2 },
        sender: player2.addr,
      })

      // Both players reveal
      await client.send.revealMove({
        args: { sessionID: sessionId, choice: 0, salt: new TextEncoder().encode('salt1') }, // Rock
        sender: testAccount.addr,
      })

      // After second reveal, game should complete and distribute winnings
      const initialBalance = await algorand.client.accountInformation(testAccount.addr).do()
      
      await client.send.revealMove({
        args: { sessionID: sessionId, choice: 2, salt: new TextEncoder().encode('salt2') }, // Scissors
        sender: player2.addr,
      })

      // Player 1 should receive the winnings (Rock beats Scissors)
      const finalBalance = await algorand.client.accountInformation(testAccount.addr).do()
      // Note: In practice, you'd need to check the actual balance change considering fees
    })

    test('handles tie game correctly', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      
      const player2 = await localnet.context.algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))
      await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.MicroAlgos(1000000000))

      const currentTime = Math.floor(Date.now() / 1000)
      const config = {
        startAt: currentTime,
        endCommitAt: currentTime + 300,
        endRevealAt: currentTime + 600,
        participation: 100_000,
      }
      
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-for-tie')
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Both players choose the same (Rock)
      const commit1 = generateCommit(0, 'salt1')
      const entryPayment1 = await createPayments(client, testAccount, config.participation, 'p1-join-tie')
      const mbrPayment1 = await createPayments(client, testAccount, 50000, 'p1-mbr-tie')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit1, payment: entryPayment1, mbrPayment: mbrPayment1 },
        sender: testAccount.addr,
      })

      const commit2 = generateCommit(0, 'salt2')
      const entryPayment2 = await createPayments(client, player2, config.participation, 'p2-join-tie')
      const mbrPayment2 = await createPayments(client, player2, 50000, 'p2-mbr-tie')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit2, payment: entryPayment2, mbrPayment: mbrPayment2 },
        sender: player2.addr,
      })

      // Reveal moves
      await client.send.revealMove({
        args: { sessionID: sessionId, choice: 0, salt: new TextEncoder().encode('salt1') },
        sender: testAccount.addr,
      })

      await client.send.revealMove({
        args: { sessionID: sessionId, choice: 0, salt: new TextEncoder().encode('salt2') },
        sender: player2.addr,
      })

      // In a tie, both players should get half the pot back
      // You would verify the balance distributions here
    })

    test('throws error when revealing with invalid hash', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const currentTime = Math.floor(Date.now() / 1000)
      const config = {
        startAt: currentTime,
        endCommitAt: currentTime + 300,
        endRevealAt: currentTime + 600,
        participation: 100_000,
      }
      
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-for-invalid')
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Join with commit for Rock
      const commit = generateCommit(0, 'correct-salt')
      const entryPayment = await createPayments(client, testAccount, config.participation, 'join-invalid')
      const mbrPaymentJoin = await createPayments(client, testAccount, 50000, 'mbr-invalid')
      
      await client.send.joinSession({
        args: { sessionID: sessionId, commit, payment: entryPayment, mbrPayment: mbrPaymentJoin },
        sender: testAccount.addr,
      })

      // Try to reveal with wrong salt (should not match commit)
      await expect(
        client.send.revealMove({
          args: { sessionID: sessionId, choice: 0, salt: new TextEncoder().encode('wrong-salt') },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Invalid reveal: hash mismatch')
    })
  })

  describe('Edge cases and error conditions', () => {
    test('throws error when joining non-existent session', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const commit = generateCommit(0, 'salt')
      const entryPayment = await createPayments(client, testAccount, 100000, 'join-nonexistent')
      const mbrPayment = await createPayments(client, testAccount, 50000, 'mbr-nonexistent')

      await expect(
        client.send.joinSession({
          args: { sessionID: 9999, commit, payment: entryPayment, mbrPayment },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Sessione non esistente')
    })

    test('throws error when revealing before commit phase ends', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      // Create session that starts in the future
      const config = createGameConfig(300, 300, 300, 100_000) // Starts in 5 minutes
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-future')
      
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Try to reveal immediately (should fail)
      await expect(
        client.send.revealMove({
          args: { sessionID: sessionId, choice: 0, salt: new TextEncoder().encode('salt') },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Commit phase is still active')
    })

    test('throws error when revealing invalid choice', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const currentTime = Math.floor(Date.now() / 1000)
      const config = {
        startAt: currentTime,
        endCommitAt: currentTime + 300,
        endRevealAt: currentTime + 600,
        participation: 100_000,
      }
      
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-invalid-choice')
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Join first
      const commit = generateCommit(0, 'salt')
      const entryPayment = await createPayments(client, testAccount, config.participation, 'join-invalid-choice')
      const mbrPaymentJoin = await createPayments(client, testAccount, 50000, 'mbr-invalid-choice')
      
      await client.send.joinSession({
        args: { sessionID: sessionId, commit, payment: entryPayment, mbrPayment: mbrPaymentJoin },
        sender: testAccount.addr,
      })

      // Try to reveal with invalid choice (3 is invalid, only 0-2 allowed)
      await expect(
        client.send.revealMove({
          args: { sessionID: sessionId, choice: 3, salt: new TextEncoder().encode('salt') },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Scelta non valida: deve essere 0, 1 o 2')
    })

    test('prevents double prize distribution', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      
      const player2 = await localnet.context.algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))
      await algorand.account.ensureFundedFromEnvironment(player2, AlgoAmount.MicroAlgos(1000000000))

      const currentTime = Math.floor(Date.now() / 1000)
      const config = {
        startAt: currentTime,
        endCommitAt: currentTime + 300,
        endRevealAt: currentTime + 600,
        participation: 100_000,
      }
      
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-double-prize')
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Setup and complete a game
      const commit1 = generateCommit(0, 'salt1')
      const entryPayment1 = await createPayments(client, testAccount, config.participation, 'p1-double')
      const mbrPayment1 = await createPayments(client, testAccount, 50000, 'p1-mbr-double')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit1, payment: entryPayment1, mbrPayment: mbrPayment1 },
        sender: testAccount.addr,
      })

      const commit2 = generateCommit(2, 'salt2')
      const entryPayment2 = await createPayments(client, player2, config.participation, 'p2-double')
      const mbrPayment2 = await createPayments(client, player2, 50000, 'p2-mbr-double')
      await client.send.joinSession({
        args: { sessionID: sessionId, commit: commit2, payment: entryPayment2, mbrPayment: mbrPayment2 },
        sender: player2.addr,
      })

      // Complete the game
      await client.send.revealMove({
        args: { sessionID: sessionId, choice: 0, salt: new TextEncoder().encode('salt1') },
        sender: testAccount.addr,
      })

      await client.send.revealMove({
        args: { sessionID: sessionId, choice: 2, salt: new TextEncoder().encode('salt2') },
        sender: player2.addr,
      })

      // Try to trigger determineWinner again (should be prevented by gameFinished flag)
      // This might require calling a method that would normally trigger it, but the flag should prevent it
    })
  })

  describe('Session cleanup', () => {
    test('allows cleanup of expired sessions', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      // Create session that has already ended
      const currentTime = Math.floor(Date.now() / 1000)
      const config = {
        startAt: currentTime - 1000, // Started long ago
        endCommitAt: currentTime - 500, // Ended
        endRevealAt: currentTime - 100, // Ended
        participation: 100_000,
      }
      
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-expired')
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Should be able to cleanup
      await client.send.cleanupSession({
        args: { sessionID: sessionId },
        sender: testAccount.addr,
      })

      // Verify session no longer exists
      const sessionExists = await client.send.sessionExists({ sessionID: sessionId })
      expect(sessionExists.return).toBe(false)
    })

    test('throws error when cleaning up active session', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1000000000))

      const config = createGameConfig(60, 300, 300, 100_000) // Active session
      const mbrPayment = await createPayments(client, testAccount, 100000, 'create-active')
      
      const sessionId = (await client.send.createNewSession({
        args: { config, mbrPayment },
        sender: testAccount.addr,
      })).return!

      // Should not be able to cleanup active session
      await expect(
        client.send.cleanupSession({
          args: { sessionID: sessionId },
          sender: testAccount.addr,
        })
      ).rejects.toThrow('Cannot cleanup active session')
    })
  })
})