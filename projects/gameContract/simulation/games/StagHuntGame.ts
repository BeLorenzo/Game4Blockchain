/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { StagHuntClient, StagHuntFactory } from '../../smart_contracts/artifacts/stagHunt/StagHuntClient'
import { Agent } from '../Agent'
import { IGameAdapter } from './IGameAdapter'

interface RoundSecret {
  choice: number
  salt: string
}

export class StagHuntGame implements IGameAdapter {
  readonly name = 'StagHunt'

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
    console.log(`${this.name} deployed. AppID: ${appClient.appId}`)
    return BigInt(appClient.appId)
  }

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

    console.log(`Session ${result.return} created. Start: round ${startAt}`)
    await this.waitUntilRound(startAt)
    return result.return!
  }

  async play_Commit(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT ---`)

    const globalState = await this.appClient!.state.global.getAll()
    const jackpotAlgo = Number(globalState['globalJackpot'] || 0) / 1_000_000
    const threshold = Number(globalState['stagThresholdPercent'] || 51)

    for (const agent of agents) {
      const prompt = this.buildPromptForAgent(agent, sessionNumber, jackpotAlgo, threshold)
      const decision = await agent.playRound(this.name, prompt)

      let safeChoice = decision.choice
      if (safeChoice !== 0 && safeChoice !== 1) {
        console.warn(`[${agent.name}] Invalid choice ${safeChoice}, defaulting to 0 (Hare)`)
        safeChoice = 0
      }

      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), {
        choice: safeChoice,
        salt: salt,
      })

      const hash = this.getHash(safeChoice, salt)

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

  private buildPromptForAgent(agent: Agent, sessionNumber: number, jackpot: number, threshold: number): string {
    const gameRules = `
GAME: Stag Hunt (Assurance Game)
Choose STAG (1) or HARE (0).

OPTIONS:
- HARE (0): Safe choice
  - Always get 80% refund regardless of what others do
  - Guaranteed result: -2 ALGO
  - No dependency on group behavior

- STAG (1): Risky cooperation
  - Need ${threshold}% of players to also choose Stag
  - If threshold MET: Winners split pot + jackpot (big win)
  - If threshold MISSED: Stags lose everything (-10 ALGO)
`.trim()

    let situation = `
CURRENT STATUS:
Game: ${sessionNumber}
Entry fee: 10 ALGO
Global jackpot: ${jackpot.toFixed(1)} ALGO
`.trim()

    if (this.lastCooperationRate !== null) {
      const coopPct = (this.lastCooperationRate * 100).toFixed(0)
      const result = this.lastCooperationRate >= threshold / 100 ? 'THRESHOLD MET ✅' : 'THRESHOLD MISSED ❌'
      situation += `\n\nLast game data:
${coopPct}% of players chose Stag → ${result}`
    } else {
      situation += `\n\nThis is the first game - no historical data available.`
    }

    const hint = `
STRATEGIC CONSIDERATIONS:
- Hare gives -2 ALGO (safe but guaranteed small loss)
- Stag needs ${threshold}% cooperation - track group patterns from history
- Jackpot accumulates from failed Stag attempts, making future successes more valuable
- Consider: Is the group coordinating? Are cooperation rates rising or falling?
`.trim()

    const personality = agent.profile.personalityDescription
    const parameters = agent.getProfileSummary()
    const lessons = agent.getLessonsLearned(this.name)
    const recentMoves = agent.getRecentHistory(this.name, 3)
    const mentalState = agent.getMentalState()

    return `
You are ${agent.name}.

═══════════════════════════════════════════════════════════
${gameRules}

${situation}

${hint}
═══════════════════════════════════════════════════════════

YOUR PERSONALITY:
${personality}

YOUR PARAMETERS:
${parameters}

═══════════════════════════════════════════════════════════

${lessons}

YOUR RECENT MOVES:
${recentMoves}

MENTAL STATE: ${mentalState}

═══════════════════════════════════════════════════════════

Analyze the situation using your personality traits and past experience.
Make your decision and explain your reasoning clearly.

Respond ONLY with JSON: {"choice": <0 or 1>, "reasoning": "<your explanation>"}
`.trim()
  }

  async play_Reveal(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
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

  async resolve(dealer: Agent, sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: RESOLUTION ---`)
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    let stags = 0
    let totalRevealed = 0

    this.roundSecrets.forEach((secret) => {
      totalRevealed++
      if (secret.choice === 1) stags++
    })

    if (totalRevealed > 0) {
      this.lastCooperationRate = stags / totalRevealed
      console.log(`📊 Cooperation rate: ${(this.lastCooperationRate * 100).toFixed(1)}%`)
    } else {
      this.lastCooperationRate = 0
    }

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

  async play_Claim(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    console.log('\n--- PHASE 4: CLAIM & FEEDBACK ---')

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
          console.log(`${agent.name}: ERROR`)
        }
      }

      await agent.finalizeRound(this.name, outcome, netProfitAlgo, sessionNumber, 1)
    }
  }

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
