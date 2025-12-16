import { Config } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account } from 'algosdk'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { GuessGameFactory } from '../artifacts/guessGame/GuessGameClient'

describe('GuessGame Contract', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({ debug: true })
  })

  beforeEach(localnet.newScope)

  const deploy = async (account: Account & TransactionSignerAccount) => {
    const factory = localnet.algorand.client.getTypedAppFactory(GuessGameFactory, {
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

  // SHA256( uint64(choice) + salt )
  const getHash = (choice: number, salt: string) => {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return crypto
      .createHash('sha256')
      .update(Buffer.concat([b, Buffer.from(salt)]))
      .digest()
  }

  describe('Game Creation & Validation', () => {
    test('creates session and initializes large frequency box', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(1_000_000_000))

      const params = await createGameParams(0, 100, 100, 1_000_000)
      
      // Check MBR for the 808-byte frequency box
      const mbrAmount = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      // Should be substantial
      expect(Number(mbrAmount)).toBeGreaterThan(300_000) 

      const mbrPayment = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(mbrAmount),
      })

      const result = await client.send.createSession({
        args: { config: params, mbrPayment: mbrPayment },
        sender: testAccount.addr,
      })

      expect(result.return).toBeDefined()
    })

    test('fails if choice is out of bounds (>100)', async () => {
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

      const hash = getHash(101, 'saltInvalid')
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
          args: { sessionId: sessionId, choice: 101n, salt: Buffer.from('saltInvalid') },
          sender: testAccount.addr,
        }),
      ).rejects.toThrow('Choice must be between 0 and 100')
    })
  })

  describe('Game Logic and Payouts', () => {
    test('Scenario: Player A(0) vs Player B(100) -> Target ~33 -> A wins', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(5_000_000_000))

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

      // Player A: Choice 0
      const hashA = getHash(0, 'saltA')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashA),
          payment: await algorand.createTransaction.payment({
            sender: testAccount.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: testAccount.addr,
      })

      // Player B: Choice 100
      const accountB = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(accountB, AlgoAmount.Algos(5))
      const hashB = getHash(100, 'saltB')
      await client.send.joinSession({
        args: {
          sessionId: sessionId,
          commit: new Uint8Array(hashB),
          payment: await algorand.createTransaction.payment({
            sender: accountB.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(1_000_000),
          }),
        },
        sender: accountB.addr,
        signer: accountB.signer,
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 0n, salt: Buffer.from('saltA') },
        sender: testAccount.addr,
      })
      await client.send.revealMove({
        args: { sessionId: sessionId, choice: 100n, salt: Buffer.from('saltB') },
        sender: accountB.addr,
        signer: accountB.signer,
      })

      const stats = await client.state.box.stats.value(sessionId)
      expect(stats?.sum).toBe(100n)
      expect(stats?.count).toBe(2n)

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Avg = 50. Target = 2/3 * 50 = 33.33 -> 33.
      // Dist A (0) = 33.
      // Dist B (100) = 67.
      // A Wins. Takes all (2M).

      const winAmountA = await client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: testAccount.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.Algo(4000)
      })

      expect(winAmountA.return).toBe(2_000_000n)
      await expect(
        client.send.claimWinnings({
        args: { sessionId: sessionId },
        sender: accountB.addr,
        signer: accountB.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(4000)})).rejects.toThrow('You did not win')
    })

    test('Scenario 3 Players: 0, 50, 100. Target 33. Winner 50.', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(5_000_000_000))

      const params = await createGameParams(0, 15, 15, 1_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })
      const sessionId = (await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      const players = []
      const inputs = [0, 50, 100]

      for (let i = 0; i < 3; i++) {
        const player = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(player, AlgoAmount.Algos(5))
        
        const hash = getHash(inputs[i], `salt${i}`)
        await client.send.joinSession({
            args: { sessionId, commit: new Uint8Array(hash), payment: await algorand.createTransaction.payment({
                sender: player.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(1_000_000)
            })},
            sender: player.addr, signer: player.signer
        })
        players.push(player)
      }

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      for (let i = 0; i < 3; i++) {
        await client.send.revealMove({
            args: { sessionId, choice: BigInt(inputs[i]), salt: Buffer.from(`salt${i}`) },
            sender: players[i].addr, signer: players[i].signer
        })
      }

      const stats = await client.state.box.stats.value(sessionId)
      expect(stats?.sum).toBe(150n)

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      // Calculation:
      // Avg = 50. Target = 33.
      // A(0) dist 33.
      // B(50) dist 17.  <-- WINNER
      // C(100) dist 67.
      
      // B claims
      const winB = await client.send.claimWinnings({
        args: { sessionId },
        sender: players[1].addr, signer: players[1].signer,
        coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(4000)
      })
      expect(winB.return).toBe(3_000_000n) // Full Pot

      await expect(client.send.claimWinnings({ args: { sessionId }, sender: players[0].addr })).rejects.toThrow()
    }, 40000)

    test('Scenario 7 Players. Target 24. Winner 22.', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(5_000_000_000))

      const params = await createGameParams(0, 15, 15, 1_000_000)
      const newGameMbr = (await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(newGameMbr),
      })
      const sessionId = (await client.send.createSession({
        args: { config: params, mbrPayment: createTx },
        sender: testAccount.addr,
      })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      const players = []
      const inputs = [35, 35, 22, 33, 57, 33, 35]

      for (let i = 0; i < 7; i++) {
        const player = i === 0 ? testAccount : algorand.account.random()
        if (i !== 0) await algorand.account.ensureFundedFromEnvironment(player, AlgoAmount.Algos(5))
        
        const hash = getHash(inputs[i], `salt${i}`)
        await client.send.joinSession({
            args: { sessionId, commit: new Uint8Array(hash), payment: await algorand.createTransaction.payment({
                sender: player.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(1_000_000)
            })},
            sender: player.addr, signer: player.signer
        })
        players.push(player)
      }

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      for (let i = 0; i < 7; i++) {
        await client.send.revealMove({
            args: { sessionId, choice: BigInt(inputs[i]), salt: Buffer.from(`salt${i}`) },
            sender: players[i].addr, signer: players[i].signer
        })
      }

      const stats = await client.state.box.stats.value(sessionId)
      expect(stats?.sum).toBe(250n)

      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      const winB = await client.send.claimWinnings({
        args: { sessionId },
        sender: players[2].addr, signer: players[2].signer,
        coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(4000)
      })
      expect(winB.return).toBe(7_000_000n) // Full Pot

      await expect(client.send.claimWinnings({ args: { sessionId }, sender: players[0].addr })).rejects.toThrow()
    }, 40000)

    test('Exact Tie: Two players choose 33, Target 22. Split Pot.', async () => {
        const { testAccount, algorand, algod } = localnet.context
        const { client } = await deploy(testAccount)
        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(5_000_000_000))
  
        const params = await createGameParams(0, 10, 10, 1_000_000)
        const createTx = await algorand.createTransaction.payment({
          sender: testAccount.addr, receiver: client.appAddress,
          amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!),
        })
        const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!
  
        while ((await algod.status().do()).lastRound < params.startAt) {
            await client.send.getRequiredMbr({ args: { command: 'join' } })
        }
  
        // Player 1: 33
        const hash1 = getHash(33, 'salt1')
        await client.send.joinSession({
            args: { sessionId, commit: new Uint8Array(hash1), payment: await algorand.createTransaction.payment({
                sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(1_000_000)
            })}, sender: testAccount.addr
        })

        // Player 2: 33
        const p2 = algorand.account.random()
        await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(5))
        const hash2 = getHash(33, 'salt2')
        await client.send.joinSession({
            args: { sessionId, commit: new Uint8Array(hash2), payment: await algorand.createTransaction.payment({
                sender: p2.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(1_000_000)
            })}, sender: p2.addr, signer: p2.signer
        })

        while ((await algod.status().do()).lastRound < params.endCommitAt) {
            await client.send.getRequiredMbr({ args: { command: 'join' } })
        }

        await client.send.revealMove({ args: { sessionId, choice: 33n, salt: Buffer.from('salt1') }, sender: testAccount.addr })
        await client.send.revealMove({ args: { sessionId, choice: 33n, salt: Buffer.from('salt2') }, sender: p2.addr, signer: p2.signer })

        while ((await algod.status().do()).lastRound < params.endRevealAt) {
            await client.send.getRequiredMbr({ args: { command: 'join' } })
        }

        // Calculation: Sum 66. N 2. Target 22.
        // Both dist 11 from target. Both win.
        const win1 = await client.send.claimWinnings({ args: { sessionId }, sender: testAccount.addr, coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(4000) })
        const win2 = await client.send.claimWinnings({ args: { sessionId }, sender: p2.addr, signer: p2.signer, coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(4000) })

        expect(win1.return).toBe(1_000_000n)
        expect(win2.return).toBe(1_000_000n)
    }, 30000)
  })

  test('Fails if trying to claim before reveal phase ends', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(2_000_000_000))

      // Quick setup: 1 player, long reveal phase
      const params = await createGameParams(0, 10, 50, 1_000_000) 
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr, receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!),
      })
      const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }      
      
      const hash = getHash(50, 'salt')
      await client.send.joinSession({
         args: { sessionId, commit: new Uint8Array(hash), payment: await algorand.createTransaction.payment({
             sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(1_000_000)
         })}, sender: testAccount.addr
      })

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }      

      await client.send.revealMove({ args: { sessionId, choice: 50n, salt: Buffer.from('salt') }, sender: testAccount.addr })

      // ATTEMPT IMMEDIATE CLAIM (Still in reveal phase)
      await expect(
        client.send.claimWinnings({
            args: { sessionId },
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(4000)
        })
      ).rejects.toThrow('Game is not finished yet')
    })


    test('Random user cannot claim winnings', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      
      const params = await createGameParams(0, 5, 5, 1_000_000)
      const createTx = await algorand.createTransaction.payment({
        sender: testAccount.addr, receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!),
      })
      const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!

      // TestAccount plays and wins
      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }
      const hash = getHash(33, 'salt')
      await client.send.joinSession({
         args: { sessionId, commit: new Uint8Array(hash), payment: await algorand.createTransaction.payment({
             sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(1_000_000)
         })}, sender: testAccount.addr
      })
      
      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }      
      await client.send.revealMove({ args: { sessionId, choice: 33n, salt: Buffer.from('salt') }, sender: testAccount.addr })
      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }
      // AN INTRUDER ATTEMPTS TO CLAIM
      const intruder = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(intruder, AlgoAmount.Algos(5))

      await expect(
        client.send.claimWinnings({
            args: { sessionId },
            sender: intruder.addr,
            signer: intruder.signer,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(4000)
        })
      ).rejects.toThrow('Player has not revealed or already claimed')
    })

    test('Player cannot claim winnings twice (Double Spend check)', async () => {
       const { testAccount, algorand, algod } = localnet.context
       const { client } = await deploy(testAccount)

       // COMPLETE GAME SETUP WHERE TESTACCOUNT WINS
       const params = await createGameParams(0, 5, 5, 1_000_000)
       const createTx = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
       const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!
       
      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }
             await client.send.joinSession({ args: { sessionId, commit: new Uint8Array(getHash(10, 's')), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(1_000_000) }) }, sender: testAccount.addr })
       
      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }       
      await client.send.revealMove({ args: { sessionId, choice: 10n, salt: Buffer.from('s') }, sender: testAccount.addr })
       
      while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }
       // FIRST CLAIM: Success
       await client.send.claimWinnings({
            args: { sessionId },
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(4000)
       })

       // SECOND CLAIM: Must fail
       await expect(
        client.send.claimWinnings({
            args: { sessionId },
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
             maxFee: AlgoAmount.MicroAlgo(4000)
        })
       ).rejects.toThrow('Player has not revealed or already claimed')
    })

    test('Handles division remainders correctly (Dust remains in contract)', async () => {
      const { testAccount, algorand, algod } = localnet.context
      const { client } = await deploy(testAccount)
      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.MicroAlgos(5_000_000_000))

      const uglyFee = 1_000_001 
      
      const params = await createGameParams(0, 10, 10, uglyFee)
      const createTx = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
      const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!

      const players = []

      while ((await algod.status().do()).lastRound < params.startAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }

      for(let i=0; i<3; i++) {
          const p = i===0 ? testAccount : algorand.account.random()
          if(i!==0) await algorand.account.ensureFundedFromEnvironment(p, AlgoAmount.Algos(5))
          await client.send.joinSession({
             args: { sessionId, commit: new Uint8Array(getHash(50, `s${i}`)), payment: await algorand.createTransaction.payment({ sender: p.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(uglyFee) }) }, sender: p.addr, signer: p.signer
          })
          players.push(p)
      }

      while ((await algod.status().do()).lastRound < params.endCommitAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })

      }      for(let i=0; i<3; i++) await client.send.revealMove({ args: { sessionId, choice: 50n, salt: Buffer.from(`s${i}`) }, sender: players[i].addr, signer: players[i].signer })
      
        while ((await algod.status().do()).lastRound < params.endRevealAt) {
        await client.send.getRequiredMbr({ args: { command: 'join' } })
      }
      // Claim for the first player
      const res = await client.send.claimWinnings({ args: { sessionId }, sender: players[0].addr, signer: players[0].signer, coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(4000) })
      
      expect(res.return).toBe(BigInt(uglyFee)) 
    })

})
