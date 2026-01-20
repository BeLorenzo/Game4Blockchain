/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { GuessGameClient, GuessGameFactory } from '../../smart_contracts/artifacts/guessGame/GuessGameClient'
import { Agent } from '../Agent'
import { IBaseGameAdapter } from './IBaseGameAdapter'

/**
 * Helper interface to store local player secrets (choice + salt)
 * required for the Reveal phase.
 */
interface RoundSecret {
  choice: number
  salt: string
}

/**
 * Adapter for the "Guess 2/3 of the Average" Game.
 * * Game Mechanics:
 * 1. Players pick a number between 0 and 100.
 * 2. The contract calculates the average of all choices.
 * 3. The Target is 2/3 of that average.
 * 4. The player closest to the Target wins the pot.
 * * This class manages the simulation lifecycle: deploying, running rounds,
 * managing the Commit-Reveal scheme, and handling agent interactions.
 */
export class GuessGame implements IBaseGameAdapter {
  readonly name = 'GuessGame'

  // Tracks historical data (Average and Target) to help Agents learn over time.
  private roundHistory: { avg: number; target: number }[] = []

  private algorand = AlgorandClient.defaultLocalNet()
  private factory: GuessGameFactory | null = null
  private appClient: GuessGameClient | null = null

  // Fixed entry fee
  private participationAmount = AlgoAmount.Algos(10)

  // Local storage for commit secrets (Salt/Choice) mapped by Agent Address
  private roundSecrets: Map<string, RoundSecret> = new Map()

  // Cache for the current session's timeline configuration
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null

  // Hardcoded durations for simulation speed (in blocks)
  private durationParams = {
    warmUp: 3n,
    commitPhase: 15n,
    revealPhase: 10n,
  }

  /**
   * Initializes a new game session on the blockchain.
   * Calculates the specific timeline (Start, Commit Deadline, Reveal Deadline) based on the current block.
   */
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error('Deploy first!')

    // Fetch current block round to calculate deadlines
    const status = (await this.algorand.client.algod.status().do()) as any
    const currentRound = BigInt(status['lastRound'])

    const startAt = currentRound + this.durationParams.warmUp
    const endCommitAt = startAt + this.durationParams.commitPhase
    const endRevealAt = endCommitAt + this.durationParams.revealPhase

    this.sessionConfig = { startAt, endCommitAt, endRevealAt }

    // Query the contract to find out exactly how much MBR is needed for the storage boxes
    const mbr = (await this.appClient.send.getRequiredMbr({ args: { command: 'newGame' }, suppressLog: true })).return!

    // Prepare the MBR payment transaction
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
      suppressLog: true,
    })

    const sessionId = Number(result.return) + 1
    console.log(`Session ${sessionId} created. Start: round ${startAt}`)

    // Fast-forward the chain to the start round
    await this.waitUntilRound(startAt)
    return result.return!
  }

  /**
   * Commit.
   * Iterates through all agents, asks them to make a decision,
   * generates a cryptographic salt, hashes the move, and submits it to the chain.
   */
  async commit(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT ---`)

    for (const agent of agents) {
      // 1. Construct the context for the LLM
      const prompt = this.buildGamePrompt(agent, sessionNumber)

      // 2. Get decision from Agent
      const decision = await agent.playRound(this.name, prompt)

      // 3. Sanitize Input: Ensure choice is an integer between 0 and 100
      let safeChoice = Math.round(decision.choice)
      if (safeChoice < 0 || safeChoice > 100) {
        console.warn(
          `[${agent.name}] ⚠️ Invalid choice ${safeChoice}. ` +
            `Valid range is 0-100. Clamping to ${Math.max(0, Math.min(100, safeChoice))}`,
        )
      }
      safeChoice = Math.max(0, Math.min(100, safeChoice))

      // 4. Generate Secret Salt and Store Locally
      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), {
        choice: safeChoice,
        salt,
      })

      // 5. Create SHA256 Hash (Choice + Salt)
      const hash = this.getHash(safeChoice, salt)

      // 6. Submit Transaction (Commit Hash + Pay Entry Fee)
      const payment = await this.algorand.createTransaction.payment({
        sender: agent.account.addr,
        receiver: this.appClient!.appAddress,
        amount: this.participationAmount,
      })

      await this.appClient!.send.joinSession({
        args: { sessionId, commit: hash, payment },
        sender: agent.account.addr,
        signer: agent.signer,
        suppressLog: true,
      })
    }
  }

  /**
   * Constructs the specific prompt for this game.
   * Injects game rules, current session status, and historical trends
   * (Average and Target history) to help the agent make an informed decision.
   */
  private buildGamePrompt(agent: Agent, sessionNumber: number): string {
    const gameRules = `
GAME: Guess 2/3 of the Average (Nash Convergence Game)

ABSOLUTE RULE: Choose integer between 0 and 100 ONLY.
Numbers outside this range are INVALID and will lose automatically.

HOW IT WORKS:
- All players submit a number (0-100)
- Average is calculated across all choices
- Target = 2/3 of that average
- Winner = player closest to the target (takes entire pot)

CRITICAL GAME THEORY:
Step 1: If everyone picks 100 → avg=100 → target=67
Step 2: If everyone picks 67 → avg=67 → target=45
Step 3: If everyone picks 45 → avg=45 → target=30
Step 4: If everyone picks 30 → avg=30 → target=20
Step 5: If everyone picks 20 → avg=20 → target=13

`.trim()

    let situation = `
CURRENT STATUS:
Round: ${sessionNumber}
Entry fee: 10 ALGO
`.trim()

    // Add historical context to help the agent detect the convergence trend
    if (this.roundHistory.length === 0) {
      situation += `\n\nFirst round - expect average around 40-50, target around 27-33.`
    } else {
      const last = this.roundHistory[this.roundHistory.length - 1]
      situation += `\n\nLast round results:`
      situation += `\nAverage: ${last.avg.toFixed(1)}, Target: ${last.target.toFixed(1)}`

      if (this.roundHistory.length >= 3) {
        const recent = this.roundHistory.slice(-3)
        const targets = recent.map((h) => h.target.toFixed(1)).join(' → ')
        situation += `\n\nTarget trend (last ${recent.length} rounds): ${targets}`
      }
    }

    const hint = `
1. Check your performanceStats for winning choices (avgProfit > 20, winRate > 0.5)
2. If you have a proven winner: Play that choice ±5
3. If you're losing: Play 10-15 points BELOW the last target
4. If losing 3+ rounds: Cut your choice by 40-50%

REMEMBER: This is a CONVERGENCE game. Winners reach the equilibrium FASTER than others.
`.trim()

    return `

${gameRules}

${situation}

${hint}

Analyze game theory, historical targets, and your performance stats.
Choose wisely between 0-100.

Respond ONLY with JSON: {"choice": <number 0-100>, "reasoning": "<your explanation>"}
`.trim()
  }

  /**
   * Reveal.
   * Waits for the commit phase to end, then submits the original choice and salt
   * for each agent to verify their commitment on-chain.
   */
  async reveal(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 2: REVEAL ---`)
    // Fast-forward chain to the reveal phase
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
            suppressLog: true,
          })
          console.log(`[${agent.name}] Revealed: ${secret.choice}`)
        } catch (e) {
          console.error(`Error revealing for ${agent.name}:`, e)
        }
      }),
    )
  }

  /**
   * Resolve.
   * In this specific game, resolution happens implicitly during the Claim phase,
   * so this method is empty.
   */
  async resolve(dealer: Agent, sessionId: bigint, sessionNumber: number): Promise<void> {
    return
  }

  /**
   * Claim.
   * Waits for the game to end, calculates local stats for reporting,
   * and triggers the claim transaction for each agent to receive payouts.
   */
  async claim(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: CLAIM ---`)
    // Fast-forward chain to the end of the game
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Calculate local statistics for the console log and history tracking
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
      console.log(`Game stats: Avg=${avg.toFixed(1)}, Target=${target.toFixed(1)}`)
    }

    // Attempt to claim for each agent
    for (const agent of agents) {
      let outcome = 'LOSS'
      let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000

      try {
        const result = await this.appClient!.send.claimWinnings({
          args: { sessionId: sessionId },
          sender: agent.account.addr,
          signer: agent.signer,
          coverAppCallInnerTransactionFees: true, // Crucial: cover inner payment fees
          maxFee: AlgoAmount.MicroAlgos(5_000), // High budget for complex calculation
          suppressLog: true,
        })

        const payoutMicro = Number(result.return!)

        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        console.log(`${agent.name}: \x1b[32m${outcome} (${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`)
      } catch (e: any) {
        outcome = 'LOSS'
        console.log(`${agent.name}: \x1b[31mLOSS\x1b[0m`)
      }
      // Feedback loop: Update agent's memory with the result
      await agent.finalizeRound(this.name, outcome, netProfitAlgo, sessionNumber, 1)
    }
  }

  /**
   * Helper utility to generate the SHA256 Commit Hash.
   * Matches the TEAL logic: SHA256(Uint64(choice) ++ Salt)
   */
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

  /**
   * Utility to fast-forward LocalNet time.
   * Sends 0-value spam transactions to force block production until the target round is reached.
   */
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
        suppressLog: true,
      })
    }
  }
}
