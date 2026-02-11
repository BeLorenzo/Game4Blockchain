/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { WeeklyGameClient, WeeklyGameFactory } from '../../smart_contracts/artifacts/weeklyGame/WeeklyGameClient'
import { Agent } from '../Agent'
import { IBaseGameAdapter, GameLogger } from './IBaseGameAdapter'
import { deploy } from '../../smart_contracts/weeklyGame/deploy-config'
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
 * Implementation of the "Weekly Lottery" (Minority Game).
 * 
 * Game Mechanics:
 * - Each player chooses a day of the week (0=Monday to 6=Sunday)
 * - The total pot is split equally among all active days (days with at least one vote)
 * - Each active day's share is then divided among players who chose that day
 * - Players on less crowded days receive larger shares (minority advantage)
 */
export class WeeklyGame implements IBaseGameAdapter {
  /** Game identifier name */
  readonly name = 'WeeklyGame'

  /** Logger for game event tracking */
  private log: GameLogger = () => {}
  /** Callback to update game state (used for UI updates) */
  private stateUpdater: (updates: any) => void = () => {}  // <-- ADDED

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

  /** Record of votes from the last round (day name -> vote count) */
  private lastRoundVotes: Record<string, number> | null = null
  /** Algorand client for blockchain interaction */
  private algorand = AlgorandClient.defaultLocalNet()
  /** Factory for smart contract deployment */
  private factory: WeeklyGameFactory | null = null
  /** Client to interact with deployed smart contract */
  private appClient: WeeklyGameClient | null = null
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

  /** Array of day names for display and mapping */
  private dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  /**
   * Deploys the smart contract on Algorand
   */
  async deploy(admin: Account, suffix: string = ''): Promise<void> {
    const appName = `WeeklyGame${suffix}`

    const signer = algosdk.makeBasicAccountTransactionSigner(admin)
        
    this.factory = this.algorand.client.getTypedAppFactory(WeeklyGameFactory, {
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

    const status = (await this.algorand.client.algod.status().do()) as any
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

    const initialPot = Number(this.participationAmount.microAlgos) * 0 / 1_000_000
    this.stateUpdater({ pot: initialPot })

    await this.waitUntilRound(startAt)
    return result.return!
  }

  /**
   * COMMIT phase: Agents choose and commit their day selection (0-6)
   */
  async commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    this.log(`\n--- PHASE 1: COMMIT ---`, 'system')

    const currentPot = Number(this.participationAmount.microAlgos) * agents.length / 1_000_000
    this.stateUpdater({ pot: currentPot })

    for (const agent of agents) {
      this.stateUpdater({
        agents: {
          [agent.name]: { status: 'thinking' }
        }
      })
      this.log(`[${agent.name}] Analyzing day distribution...`, 'thought')

      const prompt = this.buildGamePrompt(agent, roundNumber)
      const decision = await agent.playRound(this.name, prompt)

      // Sanitize choice (must be 0-6)
      let safeChoice = decision.choice
      if (safeChoice < 0 || safeChoice > 6) {
        this.log(`[${agent.name}] Invalid choice ${safeChoice}, defaulting to 0`, 'system')
        safeChoice = 0
      }

      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), { choice: safeChoice, salt })

      this.stateUpdater({
        agents: {
          [agent.name]: { 
            status: 'decided',
            choice: safeChoice
          }
        }
      })
      this.log(`[${agent.name}] Committed: ${this.dayNames[safeChoice]}`, 'action')

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
   * Builds agent prompt with game rules, historical data, and strategic hints
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

    // Add historical information if available
    if (this.lastRoundVotes === null) {
      situation += `\n\nFirst round - all days equally likely.`
    } else {
      // Sort days by vote count (ascending)
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
   * REVEAL phase: Agents reveal their committed day choices
   */
  async reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 2: REVEAL ---`, 'system')
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
          this.log(`[${agent.name}] Revealed: ${this.dayNames[secret.choice]}`, 'game_event')

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
   * RESOLVE phase: Empty in this implementation (resolution happens on-chain during claim)
   */
  async resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void> {
    return
  }

  /**
   * CLAIM phase: Agents claim winnings based on the day distribution
   */
  async claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 3: CLAIM ---`, 'system')
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

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
    const voteStr = Object.entries(votes)
        .filter(([_, count]) => count > 0)
        .map(([day, count]) => `${day}: ${count}`)
        .join(', ')
        
    this.log(`📊 Vote Distribution: ${voteStr}`, 'game_event')

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
          suppressLog: true,
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        
        if (outcome === 'WIN') {
            this.log(`💰 ${agent.name} WINS! (+${netProfitAlgo.toFixed(2)} ALGO)`, 'game_event')
        } else if (outcome === 'DRAW') {
            this.log(`⚖️ ${agent.name} BREAK-EVEN (0 ALGO)`, 'game_event')
        } else {
            this.log(`💸 ${agent.name} LOSES (${netProfitAlgo.toFixed(2)} ALGO)`, 'game_event')
        }
      } catch (e: any) { }

      this.stateUpdater({
        agents: {
          [agent.name]: {
            profit: netProfitAlgo,
            status: 'finished'
          }
        }
      })

      agent.finalizeRound(this.name, outcome, netProfitAlgo, roundNumber, 1)
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