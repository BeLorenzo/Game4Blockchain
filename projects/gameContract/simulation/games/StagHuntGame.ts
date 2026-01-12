/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { StagHuntClient, StagHuntFactory } from '../../smart_contracts/artifacts/stagHunt/StagHuntClient'
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
 * Adapter for the "Stag Hunt" Game (Coordination Game).
 * * Game Mechanics:
 * - Two Choices: Stag (1) or Hare (0).
 * - Hare: Low risk, low reward (guaranteed small refund).
 * - Stag: High risk, high reward (requires coordination).
 * - Win Condition: Stag players win big ONLY if a certain % of players also chose Stag.
 * * This class manages the simulation lifecycle: deploying, running rounds,
 * managing the Commit-Reveal scheme, and handling agent interactions.
 */
export class StagHuntGame implements IBaseGameAdapter {
  readonly name = 'StagHunt'

  // Tracks the cooperation rate from the previous round to help Agents learn.
  private lastCooperationRate: number | null = null
  
  private algorand = AlgorandClient.defaultLocalNet()
  private factory: StagHuntFactory | null = null
  private appClient: StagHuntClient | null = null
  
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
   * Deploys the StagHunt smart contract factory to the LocalNet.
   * Funds the contract application account to cover Minimum Balance Requirements (MBR).
   */
  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(StagHuntFactory, {
      defaultSender: admin.account.addr,
      defaultSigner: admin.signer,
    })

    const { appClient } = await this.factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
      suppressLog:true
    })

    // Fund the contract to ensure it has enough ALGO for MBR and opcodes
    await this.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, AlgoAmount.Algos(2))

    this.appClient = appClient
    console.log(`${this.name} deployed. AppID: ${appClient.appId}`)
    return BigInt(appClient.appId)
  }

  /**
   * Initializes a new game session on the blockchain.
   * Calculates the specific timeline (Start, Commit Deadline, Reveal Deadline) based on the current block.
   */
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error('Deploy first!')

    // Fetch current block round to calculate deadlines
    const status = await this.algorand.client.algod.status().do()
    const currentRound = BigInt(status['lastRound'])

    const startAt = currentRound + this.durationParams.warmUp
    const endCommitAt = startAt + this.durationParams.commitPhase
    const endRevealAt = endCommitAt + this.durationParams.revealPhase

    this.sessionConfig = { startAt, endCommitAt, endRevealAt }

    // Query the contract to find out exactly how much MBR is needed for the storage boxes
    const mbr = (await this.appClient.send.getRequiredMbr({ args: { command: 'newGame' }, suppressLog:true })).return!

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
      suppressLog:true
    })
    
    // The return value is the session ID. 
    // Assuming the contract returns the ID of the created session here.
    const sessionId = Number(result.return) + 1
    console.log(`Session ${sessionId} created. Start: round ${startAt}`)
    
    // Fast-forward the chain to the start round
    await this.waitUntilRound(startAt)
    return result.return!
  }

  /**
   * Commit.
   * Iterates through all agents, asks them to make a decision (Stag vs Hare), 
   * generates a cryptographic salt, hashes the move, and submits it to the chain.
   */
  async commit(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT ---`)

    // Fetch global state to inform agents about current Jackpot and Threshold
    const globalState = await this.appClient!.state.global.getAll()
    const jackpotAlgo = Number(globalState['globalJackpot'] || 0) / 1_000_000
    const threshold = Number(globalState['stagThresholdPercent'] || 51)

    for (const agent of agents) {
      // 1. Construct the context for the LLM
      const prompt = this.buildGamePrompt(agent, sessionNumber, jackpotAlgo, threshold)
      
      // 2. Get decision from Agent
      const decision = await agent.playRound(this.name, prompt)

      // 3. Sanitize Input: Ensure choice is 0 (Hare) or 1 (Stag)
      let safeChoice = decision.choice
      if (safeChoice !== 0 && safeChoice !== 1) {
        console.warn(`[${agent.name}] Invalid choice ${safeChoice}, defaulting to 0 (Hare)`)
        safeChoice = 0
      }

      // 4. Generate Secret Salt and Store Locally
      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), {
        choice: safeChoice,
        salt: salt,
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
        suppressLog:true
      })
    }
  }

  /**
   * Constructs the specific prompt for this game.
   * Injects game rules, current session status, and historical trends 
   * (Cooperation rate) to help the agent make an informed decision.
   */
  private buildGamePrompt(agent: Agent, sessionNumber: number, jackpot: number, threshold: number): string {
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

    // Add historical context to help the agent assess group trust
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

    return `

${gameRules}

${situation}

${hint}

Analyze the situation using your personality traits and past experience.
Make your decision and explain your reasoning clearly.

Respond ONLY with JSON: {"choice": <0 or 1>, "reasoning": "<your explanation>"}
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
            suppressLog:true
          })
          console.log(`[${agent.name}] Revealed: ${secret.choice === 1 ? 'STAG' : 'HARE'}`)
        } catch (e) {
          console.error(`Error revealing for ${agent.name}:`, e)
        }
      }),
    )
  }

  /**
   * Resolution.
   * Triggers the smart contract to calculate whether the Stag Threshold was met.
   * Updates local stats (Cooperation Rate) for the next round's prompt.
   */
  async resolve(dealer: Agent, sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: RESOLUTION ---`)
    // Fast-forward chain to the resolution phase
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Calculate cooperation rate locally for logging and history
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
      // Trigger the contract logic to payout or rollover the Jackpot
      await this.appClient!.send.resolveSession({
        args: { sessionId },
        sender: dealer.account.addr,
        signer: dealer.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgos(5_000),
        suppressLog:true
      })
    } catch (e) {
      console.error('Resolution error:', e)
    }
  }

  /**
   * Claim & Feedback.
   * Agents claim their winnings (or refunds for Hares).
   * Updates each agent's memory with the round result.
   */
  async claim(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
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
          suppressLog:true
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
        suppressLog: true
      })
    }
  }
}
