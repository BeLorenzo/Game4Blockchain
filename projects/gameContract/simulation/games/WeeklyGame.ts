/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { WeeklyGameClient, WeeklyGameFactory } from '../../smart_contracts/artifacts/weeklyGame/WeeklyGameClient'
import { Agent, RoundContext } from '../Agent'
import { IGameAdapter } from './IGameAdapter'

interface RoundSecret {
  choice: number
  salt: string
}

export class WeeklyGame implements IGameAdapter {
  // Game history tracking
  private lastRoundVotes: Record<string, number> | null = null

  private algorand = AlgorandClient.defaultLocalNet()
  private factory: WeeklyGameFactory | null = null
  private appClient: WeeklyGameClient | null = null

  private participationAmount = AlgoAmount.Algos(10)
  private roundSecrets: Map<string, RoundSecret> = new Map()
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null

  private durationParams = {
    warmUp: 3n,
    commitPhase: 15n,
    revealPhase: 10n,
  }

  private dayMap = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // --- 1. DEPLOY ---
  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(WeeklyGameFactory, {
      defaultSender: admin.account.addr,
      defaultSigner: admin.signer,
    })

    const { appClient } = await this.factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
    })

    await this.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, AlgoAmount.Algos(2))

    this.appClient = appClient
    console.log(`WeeklyGame contract deployed. AppID: ${appClient.appId}`)
    return BigInt(appClient.appId)
  }

  // --- 2. START SESSION ---
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error('Deploy first!')

    const status = (await this.algorand.client.algod.status().do()) as any
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

    console.log(`WeeklyGame session created! ID: ${result.return}. Start: ${startAt}`)
    await this.waitUntilRound(startAt)
    return result.return!
  }

  // --- 3. COMMIT PHASE ---
  async play_Commit(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT (Pick a Day) ---`)

    // Prepare context with data-only approach
    const marketSituation = this.prepareMarketSituation()

    const context: RoundContext = {
      gameRules: 'Pick day (0=Mon...6=Sun). Pot splits equally across active days, then among players per day.',
      marketSituation: marketSituation,
    }

    for (const agent of agents) {
      const decision = await agent.playRound('WeeklyGame', context)

      let safeChoice = decision.choice
      if (safeChoice < 0 || safeChoice > 6) {
        console.warn(`[${agent.name}] Invalid choice (${safeChoice}), fallback to 0.`)
        safeChoice = 0
      }

      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), { choice: safeChoice, salt })

      const hash = this.getHash(safeChoice, salt)
      console.log(`[${agent.name}] Picked a day (hash sent).`)

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
  private prepareMarketSituation(): string {
    if (this.lastRoundVotes === null) {
      return 'First round. All days (0=Mon...6=Sun) available. No historical data.'
    }

    // Show raw vote counts - AI must analyze minority game dynamics
    const votesList = Object.entries(this.lastRoundVotes)
      .sort(([, a], [, b]) => a - b) // Sort by votes (ascending)
      .map(([day, votes]) => `${day}:${votes}`)
      .join(', ')

    const activeDays = Object.values(this.lastRoundVotes).filter((v) => v > 0).length

    return `
Last round votes: ${votesList}.
Active days: ${activeDays} (pot was split ${activeDays} ways).
Each active day's portion then split among players who chose it.
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
          console.log(`[${agent.name}] Revealed: ${this.dayMap[secret.choice]} (${secret.choice})`)
        } catch (e) {
          console.error(`Error revealing for ${agent.name}:`, e)
        }
      }),
    )
  }

  // --- 5. CLAIM PHASE (+ DATA COLLECTION) ---
  async play_Claim(agents: Agent[], sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: CLAIM & DATA COLLECTION ---`)
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Collect votes for next round analysis
    const votes: Record<string, number> = {}
    const daysMap = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    daysMap.forEach((d) => (votes[d] = 0))

    agents.forEach((agent) => {
      const secret = this.roundSecrets.get(agent.account.addr.toString())
      if (secret) {
        const dayName = daysMap[secret.choice]
        votes[dayName] = (votes[dayName] || 0) + 1
      }
    })

    this.lastRoundVotes = votes
    console.log('📊 [GAME STATS] Votes:', votes)

    // Process claims
    for (const agent of agents) {
      let outcome = 'LOSS'
      let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000

      try {
        const result = await this.appClient!.send.claimWinnings({
          args: { sessionId: sessionId },
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
          console.error(`❌ Unexpected error for ${agent.name}:`, e.message)
        }
      }

      const groupContext = outcome === 'WIN' ? 'WIN' : 'LOSS'
      agent.finalizeRound('WeeklyGame', outcome, netProfitAlgo, groupContext, 1)
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

  async resolve(dealer: Agent, sessionId: bigint): Promise<void> {
    return
  }
}
