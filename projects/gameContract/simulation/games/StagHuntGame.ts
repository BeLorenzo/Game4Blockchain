/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { StagHuntClient, StagHuntFactory } from '../../smart_contracts/artifacts/stagHunt/StagHuntClient'
import { Agent, RoundContext } from '../Agent'

interface RoundSecret {
  choice: number
  salt: string
}

export class StagHuntGame {
  // Game history tracking
  private lastCooperationRate: number | null = null

  private algorand = AlgorandClient.defaultLocalNet()
  private factory: StagHuntFactory | null = null
  private appClient: StagHuntClient | null = null

  private participationAmount = AlgoAmount.Algos(10)
  private roundSecrets: Map<string, RoundSecret> = new Map()

  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null

  private durationParams = {
    warmUp: 3n,
    commitPhase: 15n,
    revealPhase: 10n,
  }

  // --- 1. DEPLOY ---
  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(StagHuntFactory, {
      defaultSender: admin.account.addr,
      defaultSigner: admin.signer,
    })

    const { appClient } = await this.factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
    })

    await this.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, AlgoAmount.Algos(2))

    this.appClient = appClient
    console.log(`StagHunt contract deployed. AppID: ${appClient.appId}`)
    return BigInt(appClient.appId)
  }

  // --- 2. START SESSION ---
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error('Deploy first!')

    const status = await this.algorand.client.algod.status().do()
    const currentRound = BigInt(status['lastRound'])

    const startAt = currentRound + this.durationParams.warmUp
    const endCommitAt = startAt + this.durationParams.commitPhase
    const endRevealAt = endCommitAt + this.durationParams.revealPhase

    this.sessionConfig = { startAt, endCommitAt, endRevealAt }

    const mbr = (await this.appClient.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

    const mbrPayment = await this.algorand.createTransaction.payment({
      sender: dealer.account.addr,
      receiver: this.appClient.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })

    const result = await this.appClient.send.createSession({
      args: {
        config: {
          startAt,
          endCommitAt,
          endRevealAt,
          participation: this.participationAmount.microAlgos,
        },
        mbrPayment,
      },
      sender: dealer.account.addr,
      signer: dealer.signer,
    })

    console.log(`Session created! ID: ${result.return}. Starting at round ${startAt}`)

    await this.waitUntilRound(startAt)
    return result.return!
  }

  // --- 3. COMMIT PHASE ---
  async play_Commit(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT ---`)

    const globalState = await this.appClient!.state.global.getAll()
    const jackpotVal = Number(globalState['globalJackpot'] || 0)
    const jackpotAlgo = jackpotVal / 1_000_000

    // Prepare context with data-only approach
    const marketSituation = this.prepareMarketSituation(jackpotAlgo)

    const context: RoundContext = {
      gameRules: 'Stag (1) = high risk, requires group coordination. Hare (0) = safe, 80% refund.',
      marketSituation: marketSituation,
    }

    for (const agent of agents) {
      const decision = await agent.playRound('StagHunt', context)

      const salt = crypto.randomBytes(16).toString('hex')

      this.roundSecrets.set(agent.account.addr.toString(), {
        choice: decision.choice,
        salt: salt,
      })

      const hash = this.getHash(decision.choice, salt)

      console.log(`[${agent.name}] Decision: ${decision.choice} (hash sent)`)

      const payment = await this.algorand.createTransaction.payment({
        sender: agent.account.addr,
        receiver: this.appClient!.appAddress,
        amount: this.participationAmount,
      })

      await this.appClient!.send.joinSession({
        args: { sessionId, commit: hash, payment },
        sender: agent.account.addr,
        signer: agent.signer,
      })
    }
  }

  // --- PREPARE MARKET SITUATION (DATA-ONLY) ---
  private prepareMarketSituation(jackpot: number): string {
    if (this.lastCooperationRate === null) {
      return `Entry: 10 ALGO. Hare refunds 8 ALGO (80%). Stag requires coordination. Jackpot available: ${jackpot.toFixed(1)} ALGO. First round, no data on group behavior.`
    }

    // Show raw numbers - AI must analyze cooperation patterns
    const stagsPercent = (this.lastCooperationRate * 100).toFixed(0)
    const haresPercent = (100 - this.lastCooperationRate * 100).toFixed(0)

    return `
Last round: ${stagsPercent}% chose Stag, ${haresPercent}% chose Hare.
Entry: 10 ALGO. Hare refunds 8 ALGO (80%).
Jackpot available: ${jackpot.toFixed(1)} ALGO (splits among Stag players if threshold met).
    `.trim()
  }

  // --- 4. REVEAL PHASE ---
  async play_Reveal(agents: Agent[], sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 2: REVEAL ---`)
    await this.waitUntilRound(this.sessionConfig.endCommitAt + 1n)

    await Promise.all(
      agents.map(async (agent) => {
        const secret = this.roundSecrets.get(agent.account.addr.toString())
        if (!secret) return

        try {
          await this.appClient!.send.revealMove({
            args: {
              sessionId,
              choice: BigInt(secret.choice),
              salt: Buffer.from(secret.salt),
            },
            sender: agent.account.addr,
            signer: agent.signer,
          })
          console.log(`[${agent.name}] Revealed: ${secret.choice === 1 ? 'STAG' : 'HARE'}`)
        } catch (e) {
          console.error(`Error revealing for ${agent.name}:`, e)
        }
      }),
    )
  }

  // --- 5. RESOLVE & DATA COLLECTION ---
  async resolve(dealer: Agent, sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: RESOLUTION ---`)
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Collect cooperation rate for next round
    let stags = 0
    let totalRevealed = 0

    this.roundSecrets.forEach((secret) => {
      totalRevealed++
      if (secret.choice === 1) stags++
    })

    if (totalRevealed > 0) {
      this.lastCooperationRate = stags / totalRevealed
      console.log(`📊 [GAME STATS] Cooperation rate: ${(this.lastCooperationRate * 100).toFixed(1)}%`)
    } else {
      this.lastCooperationRate = 0
    }

    // Resolve on-chain
    try {
      await this.appClient!.send.resolveSession({
        args: { sessionId },
        sender: dealer.account.addr,
        signer: dealer.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(5_000),
      })
    } catch (e) {
      console.error('Resolution error:', e)
    }
  }

  // --- 6. CLAIM PHASE ---
  async play_Claim(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log('\n--- PHASE 4: CLAIM & FEEDBACK ---')

    // Determine group result
    let groupResult = 'LOSS'
    try {
      const stats = await this.appClient?.state.box.stats.value(sessionId)
      if (stats && stats.successful) groupResult = 'WIN'
    } catch (e) {}

    for (const agent of agents) {
      let outcome = 'LOSS'
      let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000

      try {
        const result = await this.appClient!.send.claimWinnings({
          args: { sessionId },
          sender: agent.account.addr,
          signer: agent.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgos(3_000),
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        console.log(`${agent.name}: \x1b[32m${outcome} (${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`)
      } catch (e: any) {
        if (e.message && e.message.includes('assert failed')) {
          console.log(`${agent.name}: \x1b[31mLOSS (No winnings)\x1b[0m`)
        } else {
          console.log(`${agent.name}: ERROR (${e.message.substring(0, 50)}...)`)
        }
      }

      agent.finalizeRound('StagHunt', outcome, netProfitAlgo, groupResult, 1)
    }
  }

  // --- UTILS ---
  private getHash(choice: number, salt: string): Uint8Array {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return new Uint8Array(
      crypto
        .createHash('sha256')
        .update(Buffer.concat([b, Buffer.from(salt)]))
        .digest(),
    )
  }

  private async waitUntilRound(targetRound: bigint) {
    const status = (await this.algorand.client.algod.status().do()) as any
    const currentRound = BigInt(status['lastRound'])

    if (currentRound >= targetRound) return

    const blocksToSpam = Number(targetRound - currentRound)

    const spammer = await this.algorand.account.random()
    await this.algorand.account.ensureFundedFromEnvironment(spammer.addr, AlgoAmount.Algos(1))

    for (let i = 0; i < blocksToSpam; i++) {
      await this.algorand.send.payment({
        sender: spammer.addr,
        receiver: spammer.addr,
        amount: AlgoAmount.MicroAlgos(0),
        signer: spammer.signer,
        note: `spam-${i}-${Date.now()}`,
      })
    }
  }
}
