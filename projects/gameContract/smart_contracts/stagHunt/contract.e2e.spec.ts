/* eslint-disable @typescript-eslint/no-explicit-any */
import { Config } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Account } from 'algosdk'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { StagHuntFactory } from '../artifacts/stagHunt/StagHuntClient'

describe('StagHunt Contract', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({ debug: true })
  })

  beforeEach(localnet.newScope)

  const deploy = async (account: Account & TransactionSignerAccount) => {
    const factory = localnet.algorand.client.getTypedAppFactory(StagHuntFactory, {
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
        AlgoAmount.MicroAlgos(200_000_000)
    )
    return { client: appClient }
  }

  const createGameParams = async (startAt: number, endCommitAt: number, endRevealAt: number, participationAmount: number) => {
    const now = (await localnet.context.algod.status().do()).lastRound
    const start = now + BigInt(startAt) + 20n 
    const commit = start + BigInt(endCommitAt)
    const reveal = commit + BigInt(endRevealAt)
    
    return {
      startAt: start,
      endCommitAt: commit,
      endRevealAt: reveal,
      participation: BigInt(participationAmount),
    }
  }

  const getHash = (choice: number, salt: string) => {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return crypto.createHash('sha256').update(Buffer.concat([b, Buffer.from(salt)])).digest()
  }

  const waitRounds = async (targetRound: bigint, client: any) => {
      const algod = localnet.context.algod
      while ((await algod.status().do()).lastRound < targetRound) {
         await client.send.getRequiredMbr({ args: { command: 'join' } }) 
      }
  }

  describe('Admin & Configuration', () => {
    test('Admin can update rules, Intruder cannot', async () => {
      const { testAccount, algorand } = localnet.context
      const { client } = await deploy(testAccount)

      await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

      await client.send.updateGameRules({
        args: { newRefund: 50n, newThreshold: 90n },
        sender: testAccount.addr
      })

      const globalState = await client.state.global.getAll()
      expect(globalState.hareRefundPercent).toBe(50n)
      expect(globalState.stagThresholdPercent).toBe(90n)

      const intruder = algorand.account.random()
      await algorand.account.ensureFundedFromEnvironment(intruder, AlgoAmount.Algos(1))

      await expect(
        client.send.updateGameRules({
            args: { newRefund: 100n, newThreshold: 10n },
            sender: intruder.addr,
            signer: intruder.signer
        })
      ).rejects.toThrow('Only creator can update rules')
    })
  })

  describe('Game Mechanics', () => {

    test('Scenario: Success (Cooperation). 3 Stags, 1 Hare.', async () => {
        const { testAccount, algorand } = localnet.context
        const { client } = await deploy(testAccount)
        
        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

        const participation = 10_000_000
        const params = await createGameParams(0, 10, 10, participation)
        
        const createTx = await algorand.createTransaction.payment({ 
            sender: testAccount.addr, 
            receiver: client.appAddress, 
            amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) 
        })
        const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!

        // 3 Stags (1), 1 Hare (0) -> Threshold met
        const choices = [1, 1, 1, 0]
        const players = []

        await waitRounds(params.startAt, client)

        for(let i=0; i<4; i++) {
            const p = i===0 ? testAccount : algorand.account.random()
            if(i!==0) await algorand.account.ensureFundedFromEnvironment(p, AlgoAmount.Algos(20))
            
            await client.send.joinSession({
                args: { 
                    sessionId, 
                    commit: new Uint8Array(getHash(choices[i], `s${i}`)), 
                    payment: await algorand.createTransaction.payment({ sender: p.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(participation) }) 
                }, 
                sender: p.addr, signer: p.signer
            })
            players.push(p)
        }

        await waitRounds(params.endCommitAt, client)

        for(let i=0; i<4; i++) {
            await client.send.revealMove({ 
                args: { sessionId, choice: BigInt(choices[i]), salt: Buffer.from(`s${i}`) }, 
                sender: players[i].addr, signer: players[i].signer 
            })
        }

        await waitRounds(params.endRevealAt, client)

        await client.send.resolveSession({ 
            args: { sessionId }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(5000)
        })

        const stats = await client.state.box.stats.value(sessionId)
        expect(stats?.successful).toBe(true)

        // Hare Claim (80% refund)
        const hareClaim = await client.send.claimWinnings({ 
            args: { sessionId }, 
            sender: players[3].addr, 
            signer: players[3].signer,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000)
        })
        expect(hareClaim.return).toBe(8_000_000n) 

        // Stag Claim (Net Pot / 3)
        const stagClaim = await client.send.claimWinnings({ 
            args: { sessionId }, 
            sender: players[0].addr, 
            signer: players[0].signer,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000)
        })
        expect(stagClaim.return).toBe(10_666_666n)
    }, 30000)

    test('Scenario: Fail (Panic). 1 Stag, 3 Hares -> Jackpot Accumulates', async () => {
        const { testAccount, algorand } = localnet.context
        const { client } = await deploy(testAccount)
        
        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

        const participation = 10_000_000
        const params = await createGameParams(0, 10, 10, participation)
        const createTx = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
        const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!

        // 1 Stag, 3 Hares -> Threshold Fail
        const choices = [1, 0, 0, 0]
        const players = []

        await waitRounds(params.startAt, client)

        for(let i=0; i<4; i++) {
            const p = i===0 ? testAccount : algorand.account.random()
            if(i!==0) await algorand.account.ensureFundedFromEnvironment(p, AlgoAmount.Algos(20))
            await client.send.joinSession({
                args: { sessionId, commit: new Uint8Array(getHash(choices[i], `s${i}`)), payment: await algorand.createTransaction.payment({ sender: p.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(participation) }) }, sender: p.addr, signer: p.signer
            })
            players.push(p)
        }

        await waitRounds(params.endCommitAt, client)
        for(let i=0; i<4; i++) await client.send.revealMove({ args: { sessionId, choice: BigInt(choices[i]), salt: Buffer.from(`s${i}`) }, sender: players[i].addr, signer: players[i].signer })
        await waitRounds(params.endRevealAt, client)

        await client.send.resolveSession({ 
            args: { sessionId }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(5000)
        })

        const stats = await client.state.box.stats.value(sessionId)
        expect(stats?.successful).toBe(false)

        // Stag Claim -> 0
        const stagClaim = await client.send.claimWinnings({ 
            args: { sessionId }, 
            sender: players[0].addr, 
            signer: players[0].signer, 
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000)
        })
        expect(stagClaim.return).toBe(0n)

        // Hare Claim -> Refund
        const hareClaim = await client.send.claimWinnings({ 
            args: { sessionId }, 
            sender: players[1].addr, 
            signer: players[1].signer, 
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000)
        })
        expect(hareClaim.return).toBe(8_000_000n)

        // Verify Jackpot (Stag Lost 10 + 3 Hares Paid 2 each = 16)
        const globalState = await client.state.global.getAll()
        expect(globalState.globalJackpot).toBe(16_000_000n)
    }, 30000)

    test('Scenario: Jackpot Win & Dynamic Stakes', async () => {
        const { testAccount, algorand } = localnet.context
        const { client } = await deploy(testAccount)

        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(200))

        // --- GAME 1: FAIL (10 ALGO Entry) ---
        const params1 = await createGameParams(0, 5, 5, 10_000_000)
        const createTx1 = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
        const s1 = (await client.send.createSession({ args: { config: params1, mbrPayment: createTx1 }, sender: testAccount.addr })).return!
        
        await waitRounds(params1.startAt, client)
        await client.send.joinSession({ args: { sessionId: s1, commit: new Uint8Array(getHash(1, 's1')), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(10_000_000) }) }, sender: testAccount.addr })
        const p2 = algorand.account.random()
        await algorand.account.ensureFundedFromEnvironment(p2, AlgoAmount.Algos(20))
        await client.send.joinSession({ args: { sessionId: s1, commit: new Uint8Array(getHash(0, 's2')), payment: await algorand.createTransaction.payment({ sender: p2.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(10_000_000) }) }, sender: p2.addr, signer: p2.signer })

        await waitRounds(params1.endCommitAt, client)
        await client.send.revealMove({ args: { sessionId: s1, choice: 1n, salt: Buffer.from('s1') }, sender: testAccount.addr })
        await client.send.revealMove({ args: { sessionId: s1, choice: 0n, salt: Buffer.from('s2') }, sender: p2.addr, signer: p2.signer })
        await waitRounds(params1.endRevealAt, client)

        await client.send.resolveSession({ 
            args: { sessionId: s1 }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(5000)
        })
        
        // Jackpot = 12 ALGO
        let globalState = await client.state.global.getAll()
        expect(globalState.globalJackpot).toBe(12_000_000n)


        // --- GAME 2: SUCCESS + HIGH STAKES (100 ALGO Entry) ---
        const params2 = await createGameParams(0, 5, 5, 100_000_000)
        const createTx2 = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
        const s2 = (await client.send.createSession({ args: { config: params2, mbrPayment: createTx2 }, sender: testAccount.addr })).return!
        
        await waitRounds(params2.startAt, client)
        await client.send.joinSession({ args: { sessionId: s2, commit: new Uint8Array(getHash(1, 'solo')), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(100_000_000) }) }, sender: testAccount.addr })
        
        await waitRounds(params2.endCommitAt, client)
        await client.send.revealMove({ args: { sessionId: s2, choice: 1n, salt: Buffer.from('solo') }, sender: testAccount.addr })
        await waitRounds(params2.endRevealAt, client)

        await client.send.resolveSession({ 
            args: { sessionId: s2 }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(5000)
        })

        // Win = Session (100) + Jackpot (12)
        const win = await client.send.claimWinnings({ 
            args: { sessionId: s2 }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000)
        })
        expect(win.return).toBe(112_000_000n)

        // Jackpot Empty
        globalState = await client.state.global.getAll()
        expect(globalState.globalJackpot).toBe(0n)
    })

    test('Scenario: Ghost Player (No Reveal). Money goes to winner.', async () => {
        const { testAccount, algorand } = localnet.context
        const { client } = await deploy(testAccount)
        
        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

        const params = await createGameParams(0, 5, 5, 10_000_000)
        const createTx = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
        const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!

        const ghost = algorand.account.random()
        await algorand.account.ensureFundedFromEnvironment(ghost, AlgoAmount.Algos(20))

        await waitRounds(params.startAt, client)

        await client.send.joinSession({ args: { sessionId, commit: new Uint8Array(getHash(1, 's1')), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(10_000_000) }) }, sender: testAccount.addr })
        // Ghost joins but won't reveal
        await client.send.joinSession({ args: { sessionId, commit: new Uint8Array(getHash(1, 'ghost')), payment: await algorand.createTransaction.payment({ sender: ghost.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(10_000_000) }) }, sender: ghost.addr, signer: ghost.signer })

        await waitRounds(params.endCommitAt, client)
        await client.send.revealMove({ args: { sessionId, choice: 1n, salt: Buffer.from('s1') }, sender: testAccount.addr })
        await waitRounds(params.endRevealAt, client)

        await client.send.resolveSession({ 
            args: { sessionId }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(5000)
        })

        // Stag wins 20 (Own 10 + Ghost's 10). Ghost forfeits funds.
        const win = await client.send.claimWinnings({ 
            args: { sessionId }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000)
        })
        expect(win.return).toBe(20_000_000n)

        await expect(
            client.send.claimWinnings({ args: { sessionId }, sender: ghost.addr, signer: ghost.signer })
        ).rejects.toThrow('Player has not revealed or already claimed')
    })

    test('Scenario: Dust Handling (Indivisible amounts go to Jackpot)', async () => {
        const { testAccount, algorand } = localnet.context
        const { client } = await deploy(testAccount)
        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))
        
        const participation = 10_000_000
        const params = await createGameParams(0, 10, 10, participation)
        const createTx = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
        const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!

        // 3 Stags, 1 Hare
        const players = []
        await waitRounds(params.startAt, client)

        // Player 0 (Stag)
        await client.send.joinSession({ args: { sessionId, commit: new Uint8Array(getHash(1, 's0')), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(participation) }) }, sender: testAccount.addr })
        players.push(testAccount)

        for(let i=1; i<4; i++) {
            const p = algorand.account.random()
            await algorand.account.ensureFundedFromEnvironment(p, AlgoAmount.Algos(20))
            const choice = i === 3 ? 0 : 1 // Player 3 is Hare
            await client.send.joinSession({ args: { sessionId, commit: new Uint8Array(getHash(choice, `s${i}`)), payment: await algorand.createTransaction.payment({ sender: p.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(participation) }) }, sender: p.addr, signer: p.signer })
            players.push(p)
        }

        await waitRounds(params.endCommitAt, client)
        for(let i=0; i<4; i++) {
            const choice = i === 3 ? 0n : 1n
            await client.send.revealMove({ args: { sessionId, choice, salt: Buffer.from(`s${i}`) }, sender: players[i].addr, signer: players[i].signer })
        }
        await waitRounds(params.endRevealAt, client)

        await client.send.resolveSession({ 
            args: { sessionId }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(5000)
        })
      
        // Jackpot should be 2 microAlgos
        const globalState = await client.state.global.getAll()       
        expect(globalState.globalJackpot).toBe(2n)
    })
  })

  describe('Safety Checks', () => {
      test('Cannot claim before resolve', async () => {
        const { testAccount, algorand } = localnet.context
        const { client } = await deploy(testAccount)
        
        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

        const params = await createGameParams(0, 5, 5, 10_000_000)
        const createTx = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
        const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!
        
        await waitRounds(params.startAt, client)
        await client.send.joinSession({ args: { sessionId, commit: new Uint8Array(getHash(1, 's')), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(10_000_000) }) }, sender: testAccount.addr })
        await waitRounds(params.endCommitAt, client)
        await client.send.revealMove({ args: { sessionId, choice: 1n, salt: Buffer.from('s') }, sender: testAccount.addr })
        await waitRounds(params.endRevealAt, client)

        await expect(
            client.send.claimWinnings({ args: { sessionId }, sender: testAccount.addr })
        ).rejects.toThrow('Game not resolved')
      }, 30000)

      test('Cannot double claim', async () => {
        const { testAccount, algorand } = localnet.context
        const { client } = await deploy(testAccount)
        await algorand.account.ensureFundedFromEnvironment(testAccount, AlgoAmount.Algos(100))

        const params = await createGameParams(0, 5, 5, 10_000_000)
        const createTx = await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos((await client.send.getRequiredMbr({ args: { command: 'newGame' } })).return!) })
        const sessionId = (await client.send.createSession({ args: { config: params, mbrPayment: createTx }, sender: testAccount.addr })).return!
        
        await waitRounds(params.startAt, client)
        await client.send.joinSession({ args: { sessionId, commit: new Uint8Array(getHash(1, 's')), payment: await algorand.createTransaction.payment({ sender: testAccount.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(10_000_000) }) }, sender: testAccount.addr })
        await waitRounds(params.endCommitAt, client)
        await client.send.revealMove({ args: { sessionId, choice: 1n, salt: Buffer.from('s') }, sender: testAccount.addr })
        await waitRounds(params.endRevealAt, client)

        await client.send.resolveSession({ 
            args: { sessionId }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(5000)
        })

        // First Claim
        await client.send.claimWinnings({ 
            args: { sessionId }, 
            sender: testAccount.addr,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000)
        })

        // Second Claim -> Should Fail
        await expect(
            client.send.claimWinnings({ 
                args: { sessionId }, 
                sender: testAccount.addr,
                coverAppCallInnerTransactionFees: true,
                maxFee: AlgoAmount.MicroAlgo(3000)
            })
        ).rejects.toThrow('Player has not revealed or already claimed')
      }, 30000)
  })
})
