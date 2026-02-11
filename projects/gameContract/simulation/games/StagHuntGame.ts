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
import algosdk, { Account, Address } from 'algosdk'

/**
 * Interface representing a round secret (choice and salt)
 * Used to generate the hash during the commit phase
 */
interface RoundSecret {
  choice: number
  salt: string
}

/**
 * Implementation of the "Stag Hunt" game (Assurance Game).
 * 
 * Game Mechanics:
 * - Each player chooses between STAG (1) or HARE (0)
 * - HARE: Safe choice - always gets 80% refund regardless of others
 * - STAG: Risky cooperation - requires threshold % of players to also choose STAG
 * - If threshold is met: Stags split the pot + accumulated jackpot
 * - If threshold is not met: Stags lose everything, Hares get 80% refund
 */
export class StagHuntGame implements IBaseGameAdapter {
  /** Game identifier name */
  readonly name = 'StagHunt'

  /** Logger for game event tracking */
  private log: GameLogger = () => {}
  /** Callback to update game state (used for UI updates) */
  private stateUpdater: (updates: any) => void = () => {}  

  /**
   * Sets the logger for event tracking
   */
  public setLogger(logger: GameLogger) {
    this.log = logger
  }

  /**
   * Sets the callback to update game state
   */
  public setStateUpdater(updater: (updates: any) => void) {
    this.stateUpdater = updater
  }

  /** Last recorded cooperation rate (percentage of players choosing Stag) */
  private lastCooperationRate: number | null = null
  /** Algorand client for blockchain interaction */
  private algorand = AlgorandClient.defaultLocalNet()
  /** Factory for smart contract deployment */
  private factory: StagHuntFactory | null = null
  /** Client to interact with deployed smart contract */
  private appClient: StagHuntClient | null = null
  /** Participation fee for the game (10 ALGO) */
  private participationAmount = AlgoAmount.Algos(10)
  /** Map of agents' secrets for current round (addr -> RoundSecret) */
  private roundSecrets: Map<string, RoundSecret> = new Map()
  /** Configuration of current session (timing based on Algorand rounds) */
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null

  /**
   * Game phase duration parameters (expressed in Algorand rounds)
   * - warmUp: wait time before game starts
   * - commitPhase: duration of commit phase
   * - revealPhase: duration of reveal phase
   */
  private durationParams = {
    warmUp: 3n,
    commitPhase: 15n,
    revealPhase: 10n,
  }

  /**
   * Deploys the smart contract on Algorand
   */
  async deploy(admin: Account, suffix: string = ''): Promise<void> {
    const appName = `StagHunt${suffix}`

    const signer = algosdk.makeBasicAccountTransactionSigner(admin)
        
    this.factory = this.algorand.client.getTypedAppFactory(StagHuntFactory, {
      defaultSender: admin.addr,
      defaultSigner: signer,
      appName: appName,
    })

    const { appClient, result } = await this.factory.deploy({
      onUpdate: 'append', 
      onSchemaBreak: 'append', 
      suppressLog: true
    })

    this.appClient = appClient

    await this.algorand.account.ensureFundedFromEnvironment(
        appClient.appAddress, 
        AlgoAmount.Algos(5)
    )

    const action = result.operationPerformed === 'create' ? 'Created new' : 'Reusing existing'
    this.log(`${action} contract: ${appName} (AppID: ${appClient.appId})`)
  }

  /**
   * Starts a new game session on Algorand
   */
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error('Deploy first!')

    const status = await this.algorand.client.algod.status().do()
    const currentRound = BigInt(status['lastRound'])

    const startAt = currentRound + this.durationParams.warmUp
    const endCommitAt = startAt + this.durationParams.commitPhase
    const endRevealAt = endCommitAt + this.durationParams.revealPhase

    this.sessionConfig = { startAt, endCommitAt, endRevealAt }

    const mbr = (await this.appClient.send.getRequiredMbr({ args: { command: 'newGame' }, suppressLog: true })).return!

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

    // Get initial jackpot value from contract and update frontend pot
    const globalState = await this.appClient!.state.global.getAll()
    const jackpotAlgo = Number(globalState['globalJackpot'] || 0) / 1_000_000
    const initialPot = jackpotAlgo 
    this.stateUpdater({ pot: initialPot })

    await this.waitUntilRound(startAt)
    return result.return!
  }

  /**
   * COMMIT phase: Agents choose and commit their moves (Stag or Hare)
   */
  async commit(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    this.log(`\n--- PHASE 1: COMMIT ---`, 'system')
    console.log(`Starting commit phase for session ${sessionId}...`)

    const globalState = await this.appClient!.state.global.getAll()
    const jackpotAlgo = Number(globalState['globalJackpot'] || 0) / 1_000_000
    const threshold = Number(globalState['stagThresholdPercent'] || 51)

    // Update current pot (jackpot + current round contributions)
    const currentPot = jackpotAlgo + Number(this.participationAmount.microAlgos) * agents.length / 1_000_000 
    this.stateUpdater({ pot: currentPot })

    for (const agent of agents) {
      this.stateUpdater({
        agents: {
          [agent.name]: { status: 'thinking' }
        }
      })
      this.log(`[${agent.name}] Analyzing the situation...`, 'thought')

      const prompt = this.buildGamePrompt(agent, sessionNumber, jackpotAlgo, threshold)
      const decision = await agent.playRound(this.name, prompt)

      let safeChoice = decision.choice
      if (safeChoice !== 0 && safeChoice !== 1) {
        this.log(`[${agent.name}] Invalid choice ${safeChoice}, defaulting to 0 (Hare)`, 'system')
        console.warn(`Agent ${agent.name} returned invalid choice:`, safeChoice)
        safeChoice = 0
      }

      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), {
        choice: safeChoice,
        salt: salt,
      })

      const choiceLabel = safeChoice === 1 ? '🦌 Stag' : '🐇 Hare'
      this.stateUpdater({
        agents: {
          [agent.name]: { 
            status: 'decided',
            choice: safeChoice
          }
        }
      })
      this.log(`[${agent.name}] Committed: ${choiceLabel}`, 'action')

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
        suppressLog: true,
      })
    }
  }

  /**
   * Builds agent prompt with game rules, current state, and strategic considerations
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

    // Add historical information if available
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
   * REVEAL phase: Agents reveal their committed choices
   */
  async reveal(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 2: REVEAL ---`, 'system')
    console.log(`Starting reveal phase for session ${sessionId}...`)
    
    await this.waitUntilRound(this.sessionConfig.endCommitAt + 1n)

    for (const agent of agents) {
      const secret = this.roundSecrets.get(agent.account.addr.toString())
      if (!secret) continue

      this.stateUpdater({
        agents: {
          [agent.name]: { status: 'revealing' }
        }
      })

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
        
        const choiceEmoji = secret.choice === 1 ? '🦌 STAG' : '🐇 HARE'
        this.log(`[${agent.name}] Revealed: ${choiceEmoji}`, 'game_event')
        console.log(`Agent ${agent.name} revealed choice ${secret.choice}`)

        this.stateUpdater({
          agents: {
            [agent.name]: { status: 'revealed', choice: secret.choice }
          }
        })
      } catch (e) {
        console.error(`Error revealing for ${agent.name}:`, e)
        this.log(`[${agent.name}] Error revealing move`, 'system')
      }
    }
  }

  /**
   * RESOLVE phase: Contract determines outcome based on revealed choices
   */
  async resolve(dealer: Agent, sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 3: RESOLUTION ---`, 'system')
    console.log(`Starting resolution phase for session ${sessionId}...`)
    
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Calculate cooperation rate from revealed choices
    let stags = 0
    let totalRevealed = 0

    this.roundSecrets.forEach((secret) => {
      totalRevealed++
      if (secret.choice === 1) stags++
    })

    if (totalRevealed > 0) {
      this.lastCooperationRate = stags / totalRevealed
      this.log(`📊 Cooperation rate: ${(this.lastCooperationRate * 100).toFixed(1)}%`, 'game_event')
      console.log(`Cooperation rate for session ${sessionId}: ${(this.lastCooperationRate * 100).toFixed(1)}%`)
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
        suppressLog: true,
      })
    } catch (e) {
      console.error('Resolution error:', e)
    }
  }

  /**
   * CLAIM phase: Agents claim their winnings based on resolution
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
            console.log(`Agent ${agent.name} won ${netProfitAlgo.toFixed(2)} ALGO`)
        } else if (outcome === 'DRAW') {
            this.log(`🤝 ${agent.name} breaks even. (0 ALGO)`, 'game_event')
            console.log(`Agent ${agent.name} broke even`)
        } else {
            this.log(`💸 ${agent.name} loses. (${netProfitAlgo.toFixed(2)} ALGO)`, 'game_event')
            console.log(`Agent ${agent.name} lost ${Math.abs(netProfitAlgo).toFixed(2)} ALGO`)
        }
      } catch (e: any) {
          this.log(`${agent.name}: ERROR`, 'system')
      }

      this.stateUpdater({
        agents: {
          [agent.name]: {
            profit: netProfitAlgo,
            status: 'finished'
          }
        }
      })

      await agent.finalizeRound(this.name, outcome, netProfitAlgo, sessionNumber, 1)
    }
  }

  /**
   * Calculates SHA256 hash of a choice and salt
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
   * Waits until Algorand blockchain reaches a specific round
   * Uses spam transactions to advance rounds in test environment
   */
  private async waitUntilRound(targetRound: bigint) {
    const status = (await this.algorand.client.algod.status().do()) as any
    const currentRound = BigInt(status['lastRound'])

    if (currentRound >= targetRound) return

    const blocksToSpam = Number(targetRound - currentRound)
    const spammer = await this.algorand.account.random()
    await this.algorand.account.ensureFundedFromEnvironment(spammer.addr, AlgoAmount.Algos(1))

    // Send empty transactions to advance rounds
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