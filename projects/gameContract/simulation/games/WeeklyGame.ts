/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { WeeklyGameClient, WeeklyGameFactory } from '../../smart_contracts/artifacts/weeklyGame/WeeklyGameClient'
import { Agent } from '../Agent'
import { IBaseGameAdapter } from './IBaseGameAdapter'
import { deploy } from '../../smart_contracts/weeklyGame/deploy-config'

/**
 * Helper interface to store local player secrets (choice + salt)
 * required for the Reveal phase.
 */
interface RoundSecret {
  choice: number
  salt: string
}

/**
 * Adapter for the "Weekly Lottery" Game (Minority Game variant).
 * * Game Mechanics:
 * 1. Players pick a day of the week (0-6).
 * 2. Total pot is split equally across ALL active days (days with >0 players).
 * 3. Each active day's share is then split among the players who chose that day.
 * 4. Goal: Choose a day that is active but has the fewest other players.
 * * This class manages the simulation lifecycle: deploying, running rounds,
 * managing the Commit-Reveal scheme, and handling agent interactions.
 */
export class WeeklyGame implements IBaseGameAdapter {
  readonly name = 'WeeklyGame'

  // Tracks vote distribution from the previous round to help Agents learn.
  private lastRoundVotes: Record<string, number> | null = null

  private algorand = AlgorandClient.defaultLocalNet()
  private factory: WeeklyGameFactory | null = null
  private appClient: WeeklyGameClient | null = null

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

  private dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  async deploy(deployer: Agent): Promise<void> {
    console.log(`\n🛠 Deploying ${this.name} logic...`)
    
    // Esegue il deploy usando lo script specifico importato in alto
    const deployment = await deploy();
    
    // Salva i riferimenti dentro la classe
    this.appClient = deployment.appClient;
    // Se ti serve l'appId, puoi salvarlo in una proprietà della classe se la definisci, 
    // ma appClient ha già tutto.
    
    console.log(`✅ ${this.name} ready (App ID: ${deployment.appId})`);
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
   * Iterates through all agents, asks them to make a decision (Day of Week),
   * generates a cryptographic salt, hashes the move, and submits it to the chain.
   */
  async commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT ---`)

    for (const agent of agents) {
      // 1. Construct the context for the LLM
      const prompt = this.buildGamePrompt(agent, roundNumber)

      // 2. Get decision from Agent
      const decision = await agent.playRound(this.name, prompt)

      // 3. Sanitize Input: Ensure choice is an integer between 0 and 6
      let safeChoice = decision.choice
      if (safeChoice < 0 || safeChoice > 6) {
        console.warn(`[${agent.name}] Invalid choice ${safeChoice}, defaulting to 0`)
        safeChoice = 0
      }

      // 4. Generate Secret Salt and Store Locally
      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), { choice: safeChoice, salt })

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
   * (Vote distribution) to help the agent make an informed decision.
   */
  private buildGamePrompt(agent: Agent, roundNumber: number): string {
    const gameRules = `
GAME: Weekly Lottery (Minority Game)
Choose a day of the week (0=Monday ... 6=Sunday).

HOW IT WORKS:
- All players pick a day (0-6)
- Total pot is split equally across ALL active days
- Each active day's share is split among players who chose that day
- Fewer players on your day = bigger share for you

EXAMPLE:
7 players, 70 ALGO pot
- Monday: 3 players
- Tuesday: 2 players
- Wednesday: 2 players
- Other days: 0 players

3 active days → 23.33 ALGO per day
Monday players get: 23.33 / 3 = 7.77 ALGO each
Tuesday players get: 23.33 / 2 = 11.66 ALGO each
`.trim()

    let situation = `
CURRENT STATUS:
Round: ${roundNumber}
Entry fee: 10 ALGO
`.trim()

    // Add historical context to help the agent detect crowd behavior
    if (this.lastRoundVotes === null) {
      situation += `\n\nFirst round - all days equally likely.`
    } else {
      const sortedDays = Object.entries(this.lastRoundVotes)
        .map(([day, votes]) => ({ day, votes }))
        .sort((a, b) => a.votes - b.votes)

      const activeDays = sortedDays.filter((d) => d.votes > 0).length

      situation += `\n\nLast round results:`
      situation += `\n${activeDays} active days (pot was split ${activeDays} ways)`
      situation += `\n\nVote distribution:`

      sortedDays.forEach(({ day, votes }) => {
        if (votes > 0) {
          situation += `\n• ${day}: ${votes} players`
        }
      })

      const leastCrowded = sortedDays[0]
      const mostCrowded = sortedDays[sortedDays.length - 1]

      if (leastCrowded && mostCrowded) {
        situation += `\n\nLeast crowded: ${leastCrowded.day} (${leastCrowded.votes} players)`
        situation += `\nMost crowded: ${mostCrowded.day} (${mostCrowded.votes} players)`
      }
    }

    const hint = `
STRATEGIC CONSIDERATIONS:
- This is a minority game - you want FEWER competitors on your day
- Avoid days that were crowded last round (others might avoid them too)
- Days with 0 players get nothing - need at least 1 player per day
- Consider: Are players clustering? Are they avoiding popular choices?
- Meta-game: If everyone tries to be contrarian, what happens?
`.trim()

    return `

${gameRules}

${situation}

${hint}

Choose a day (0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday).
Think about crowd dynamics and your personality.

Respond ONLY with JSON: {"choice": <0-6>, "reasoning": "<your explanation>"}
`.trim()
  }

  /**
   * Reveal.
   * Waits for the commit phase to end, then submits the original choice and salt
   * for each agent to verify their commitment on-chain.
   */
  async reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
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
          console.log(`[${agent.name}] Revealed: ${this.dayNames[secret.choice]}`)
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
  async resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void> {
    return
  }

  /**
   * Claim.
   * Waits for the game to end, calculates local stats for reporting,
   * and triggers the claim transaction for each agent to receive payouts.
   */
  async claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: CLAIM ---`)
    // Fast-forward chain to the end of the game
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Collect votes for next round's prompt history
    const votes: Record<string, number> = {}
    this.dayNames.forEach((d) => (votes[d] = 0))

    agents.forEach((agent) => {
      const secret = this.roundSecrets.get(agent.account.addr.toString())
      if (secret) {
        const dayName = this.dayNames[secret.choice]
        votes[dayName] = (votes[dayName] || 0) + 1
      }
    })

    this.lastRoundVotes = votes
    console.log('📊 Vote distribution:', votes)

    // Process claims for each agent
    for (const agent of agents) {
      let outcome = 'LOSS'
      let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000

      try {
        const result = await this.appClient!.send.claimWinnings({
          args: { sessionId: sessionId },
          sender: agent.account.addr,
          signer: agent.signer,
          coverAppCallInnerTransactionFees: true, // Crucial: cover inner payment fees
          maxFee: AlgoAmount.MicroAlgos(3_000),
          suppressLog: true,
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

      // Feedback loop: Update agent's memory with the result
      agent.finalizeRound(this.name, outcome, netProfitAlgo, roundNumber, 1)
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
