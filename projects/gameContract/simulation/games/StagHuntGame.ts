/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { StagHuntClient, StagHuntFactory } from '../../smart_contracts/artifacts/stagHunt/StagHuntClient'
import { Agent } from '../Agent'
import { IBaseGameAdapter, GameLogger } from './IBaseGameAdapter'
import { deploy } from '../../smart_contracts/stagHunt/deploy-config'

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
 */
export class StagHuntGame implements IBaseGameAdapter {
  readonly name = 'StagHunt'

  private log: GameLogger = () => {}

  public setLogger(logger: GameLogger) {
    this.log = logger
  }


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

async deploy(admin: Agent, suffix: string = ''): Promise<void> {
    const appName = `StagHunt${suffix}`; // Esempio: "PirateGame_Sim" vs "PirateGame"

    // 1. Configura la Factory con il nome specifico
    this.factory = this.algorand.client.getTypedAppFactory(StagHuntFactory, {
      defaultSender: admin.account.addr,
      defaultSigner: admin.signer,
      appName: appName, // Questo separa le istanze sulla chain
    })

    // 2. Deploy Idempotente (Stile GuessGame)
    // Se l'app esiste già (stesso nome, stesso creatore), la riusa.
    // Se non esiste o il codice è cambiato, la crea/aggiorna.
    const { appClient, result } = await this.factory.deploy({
      onUpdate: 'append', 
      onSchemaBreak: 'append', 
      suppressLog: true
    })

    this.appClient = appClient

    // 3. Finanzia il contratto se necessario (idempotente)
    await this.algorand.account.ensureFundedFromEnvironment(
        appClient.appAddress, 
        AlgoAmount.Algos(5)
    )

    const action = result.operationPerformed === 'create' ? 'Created new' : 'Reusing existing';
    this.log(`${action} contract: ${appName} (AppID: ${appClient.appId})`)
  }

  /**
   * Initializes a new game session on the blockchain.
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
    this.log(`Session ${sessionId} created. Start: round ${startAt}`, 'game_event')
    console.log(`Session ${sessionId} created with config:`, this.sessionConfig)

    await this.waitUntilRound(startAt)
    return result.return!
  }

  /**
   * Commit.
   */
  async commit(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    this.log(`\n--- PHASE 1: COMMIT ---`, 'system')
    console.log(`Starting commit phase for session ${sessionId}...`)

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
        this.log(`[${agent.name}] Invalid choice ${safeChoice}, defaulting to 0 (Hare)`, 'system')
        console.warn(`Agent ${agent.name} returned invalid choice:`, safeChoice)
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
        suppressLog: true,
      })
    }
  }

  /**
   * Constructs the specific prompt for this game.
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
   */
  async reveal(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 2: REVEAL ---`, 'system')
    console.log(`Starting reveal phase for session ${sessionId}...`)
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
          this.log(`[${agent.name}] Revealed: ${secret.choice === 1 ? '🦌 STAG' : '🐇 HARE'}`, 'game_event')
          console.log(`Agent ${agent.name} revealed choice ${secret.choice} with salt ${secret.salt}`)
        } catch (e) {
          console.error(`Error revealing for ${agent.name}:`, e)
          this.log(`[${agent.name}] Error revealing move`, 'system')
          console.error(`Reveal error for ${agent.name}:`, e)
        }
      }),
    )
  }

  /**
   * Resolution.
   */
  async resolve(dealer: Agent, sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 3: RESOLUTION ---`, 'system')
    console.log(`Starting resolution phase for session ${sessionId}...`)
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
      this.log(`📊 Cooperation rate: ${(this.lastCooperationRate * 100).toFixed(1)}%`, 'game_event')
      console.log(`Cooperation rate for session ${sessionId}: ${(this.lastCooperationRate * 100).toFixed(1)}% (${stags} Stags out of ${totalRevealed} revealed)`)
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
        suppressLog: true,
      })
    } catch (e) {
      console.error('Resolution error:', e)
    }
  }

  /**
   * Claim & Feedback.
   */
  async claim(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    this.log('\n--- PHASE 4: CLAIM & FEEDBACK ---', 'system')
    console.log(`Starting claim phase for session ${sessionId}...`)
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
          suppressLog: true,
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        
        if (outcome === 'WIN') {
            this.log(`💰 ${agent.name} WINS! (+${netProfitAlgo.toFixed(2)} ALGO)`, 'game_event')
            console.log(`Agent ${agent.name} won ${netProfitAlgo.toFixed(2)} ALGO in session ${sessionId}`)
        } else if (outcome === 'DRAW') {
            this.log(`🤝 ${agent.name} breaks even. (0 ALGO)`, 'game_event')
            console.log(`Agent ${agent.name} broke even in session ${sessionId}`)
        } else {
            this.log(`💸 ${agent.name} loses. (${netProfitAlgo.toFixed(2)} ALGO)`, 'game_event')
            console.log(`Agent ${agent.name} lost ${Math.abs(netProfitAlgo).toFixed(2)} ALGO in session ${sessionId}`)
        }
      } catch (e: any) {
          this.log(`${agent.name}: ERROR`, 'system')
      }

      // Feedback loop: Update agent's memory with the result
      await agent.finalizeRound(this.name, outcome, netProfitAlgo, sessionNumber, 1)
    }
  }

  /**
   * Helper utility to generate the SHA256 Commit Hash.
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