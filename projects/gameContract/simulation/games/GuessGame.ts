/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { GuessGameClient, GuessGameFactory } from '../../smart_contracts/artifacts/guessGame/GuessGameClient'
import { Agent } from '../Agent'
import { IGameAdapter } from './IGameAdapter'

interface RoundSecret {
  choice: number
  salt: string
}

export class GuessGame implements IGameAdapter {
  readonly name = 'GuessGame'

  private roundHistory: { avg: number; target: number }[] = []
  private algorand = AlgorandClient.defaultLocalNet()
  private factory: GuessGameFactory | null = null
  private appClient: GuessGameClient | null = null
  private participationAmount = AlgoAmount.Algos(10)
  private roundSecrets: Map<string, RoundSecret> = new Map()
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null

  private durationParams = {
    warmUp: 3n,
    commitPhase: 15n,
    revealPhase: 10n,
  }

  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(GuessGameFactory, {
      defaultSender: admin.account.addr,
      defaultSigner: admin.signer,
    })

    const { appClient } = await this.factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
    })

    await this.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, AlgoAmount.Algos(5))

    this.appClient = appClient
    console.log(`${this.name} deployed. AppID: ${appClient.appId}`)
    return BigInt(appClient.appId)
  }

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

    console.log(`Session ${result.return} created. Start: round ${startAt}`)
    await this.waitUntilRound(startAt)
    return result.return!
  }

  async play_Commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT ---`)

    for (const agent of agents) {
      const prompt = this.buildPromptForAgent(agent, roundNumber)
      const decision = await agent.playRound(this.name, prompt)

      let safeChoice = Math.round(decision.choice)
      if (safeChoice < 0 || safeChoice > 100) {
        console.warn(
          `[${agent.name}] ⚠️ Invalid choice ${safeChoice}. ` +
            `Valid range is 0-100. Clamping to ${Math.max(0, Math.min(100, safeChoice))}`,
        )
      }
      safeChoice = Math.max(0, Math.min(100, safeChoice))

      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), {
        choice: safeChoice,
        salt,
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

  private buildPromptForAgent(agent: Agent, roundNumber: number): string {
    // 1. GAME RULES
    const gameRules = `
GAME: Guess 2/3 of the Average
⚠️⚠️⚠️ CRITICAL RULE ⚠️⚠️⚠️
You MUST choose an integer between 0 and 100 (inclusive).
Any number outside this range will be AUTOMATICALLY CHANGED to 100.
Do NOT choose numbers above 100 - they will not work as you expect!

HOW IT WORKS:
- All players submit a number (0-100). Not lower. Not higher
- Average is calculated across all choices
- Target = 2/3 of that average
- Winner = player closest to the target
- Winner takes entire pot

EXAMPLE:
If choices are [30, 60, 90], average = 60, target = 40
Player who chose 30 wins (closest to 40)
`.trim()

    // 2. CURRENT SITUATION
    let situation = `
CURRENT STATUS:
Round: ${roundNumber}
Entry fee: 10 ALGO
`.trim()

    if (this.roundHistory.length === 0) {
      situation += `\n\nFirst round - no historical data.`
    } else {
      const last = this.roundHistory[this.roundHistory.length - 1]
      situation += `\n\nLast round results:
Average was ${last.avg.toFixed(1)}
Target was ${last.target.toFixed(1)}`

      if (this.roundHistory.length >= 3) {
        const recent = this.roundHistory.slice(-5)
        const targets = recent.map((h) => h.target.toFixed(1)).join(' → ')
        situation += `\n\nTarget trend (last ${recent.length} rounds): ${targets}`
      }
    }

    // 3. STRATEGIC HINT
    const hint = `
STRATEGIC CONSIDERATIONS:
- Nash equilibrium (pure rational play) is 0
- Most humans don't play Nash - they play higher
- Game theory suggests convergence toward lower numbers over time
- Pay attention to whether targets are rising or falling
- Consider: Are players getting more sophisticated or staying naive?
- It's impossible that the target is over 100
`.trim()

    // 4. AGENT'S DATA
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

Based on the game mechanics, historical data, and your personality:
Choose a number between 0 and 100.

Respond ONLY with JSON: {"choice": <number 0-100>, "reasoning": "<your explanation>"}
`.trim()
  }

  async play_Reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
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
          console.log(`[${agent.name}] Revealed: ${secret.choice}`)
        } catch (e) {
          console.error(`Error revealing for ${agent.name}:`, e)
        }
      }),
    )
  }

  async resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void> {
    // GuessGame doesn't need explicit resolve - winner determined during claim
    return
  }

  async play_Claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: CLAIM ---`)
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Collect data for next round
    const currentRoundChoices: number[] = []
    agents.forEach((agent) => {
      const secret = this.roundSecrets.get(agent.account.addr.toString())
      if (secret) currentRoundChoices.push(secret.choice)
    })

    if (currentRoundChoices.length > 0) {
      const sum = currentRoundChoices.reduce((a, b) => a + b, 0)
      const avg = sum / currentRoundChoices.length
      const target = avg * (2 / 3)

      this.roundHistory.push({ avg, target })
      console.log(`📊 Round stats: Avg=${avg.toFixed(1)}, Target=${target.toFixed(1)}`)
    }

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
          maxFee: AlgoAmount.MicroAlgos(5_000),
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        console.log(`${agent.name}: \x1b[32m${outcome} (${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`)
      } catch (e: any) {
        if (e.message && e.message.includes('assert failed')) {
          console.log(`${agent.name}: \x1b[31mLOSS\x1b[0m`)
        } else {
          console.error(`${agent.name}: ERROR`)
        }
      }

      agent.finalizeRound(this.name, outcome, netProfitAlgo, roundNumber)
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
