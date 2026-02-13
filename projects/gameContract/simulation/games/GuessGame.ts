/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { GuessGameClient, GuessGameFactory } from '../../smart_contracts/artifacts/guessGame/GuessGameClient'
import { Agent } from '../Agent'
import { IBaseGameAdapter, GameLogger } from './IBaseGameAdapter'
import { deploy } from '../../smart_contracts/guessGame/deploy-config'
import algosdk, { Account, Address } from 'algosdk'

/**
 * Interface representing a round secret (choice and salt)
 */
interface RoundSecret {
  choice: number
  salt: string
}

/**
 * Implementation of the "Guess 2/3 of the Average" game
 * 
 * This is a classic game theory problem where each player chooses
 * a number between 0 and 100, and the winner is the one who chooses
 * the number closest to 2/3 of the average of all chosen numbers.
 * 
 * The game runs on Algorand using smart contracts to ensure transparency
 * and fair execution. It follows a commit-reveal pattern to prevent cheating.
 * 
 * Game phases:
 * 1. COMMIT: Each player sends the hash of their choice (with salt)
 * 2. REVEAL: Each player reveals their choice and salt to verify the hash
 * 3. CLAIM: Players claim winnings, smart contract determines the winner
 */
export class GuessGame implements IBaseGameAdapter {
  /** Game identifier name */
  readonly name = 'GuessGame'

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

  /** History of previous rounds (average and target) to help agents' decisions */
  private roundHistory: { avg: number; target: number }[] = []
  /** Algorand client for blockchain interaction */
  private algorand = AlgorandClient.fromEnvironment()
  /** Factory for smart contract deployment */
  private factory: GuessGameFactory | null = null
  /** Client to interact with deployed smart contract */
  private appClient: GuessGameClient | null = null
  /** Participation fee for the game (1 ALGO) */
  private participationAmount = AlgoAmount.Algos(1)
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
    warmUp: 10n,
    commitPhase: 40n,
    revealPhase: 30n,
  }

  /**
   * Deploys the smart contract on Algorand
   */
  async deploy(admin: Account, suffix: string = ''): Promise<void> {
    const appName = `GuessGame${suffix}`
    const signer = algosdk.makeBasicAccountTransactionSigner(admin)
    
    this.factory = this.algorand.client.getTypedAppFactory(GuessGameFactory, {
      defaultSender: admin.addr,
      defaultSigner: signer,
      appName: appName,
    })

    // Deploy contract (create if doesn't exist, otherwise use existing)
    const { appClient, result } = await this.factory.deploy({
      onUpdate: 'append', 
      onSchemaBreak: 'append', 
      suppressLog: true
    })

    this.appClient = appClient
    const appInfo = await this.algorand.account.getInformation(appClient.appAddress);
    const minBalance = AlgoAmount.Algos(1);

    if (appInfo.balance < minBalance) {
        console.log(`Funding App ${appName} from Admin...`);
        const adminSigner = algosdk.makeBasicAccountTransactionSigner(admin);
        await this.algorand.send.payment({
            sender: admin.addr,
            receiver: appClient.appAddress,
            amount: AlgoAmount.Algos(1), 
            signer: adminSigner
        });
    }
    const action = result.operationPerformed === 'create' ? 'Created new' : 'Reusing existing'
     const txId = result.operationPerformed !== 'nothing' 
      ? result.transaction.txID() 
      : undefined
      this.log(
        `${action} contract: ${appName} (AppID: ${result.appId})`, 
        'system', 
        { 
          txId: txId,       
          txType: 'DEPLOY', 
          agentName: admin.addr.toString().substring(0,6)
        }
      )
  }

  /**
   * Starts a new game session
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

    // NOTE: Contract returns sessionId-1, so we add 1 for clarity
    const sessionId = Number(result.return) + 1
    this.log(`Session ${sessionId} created. Start: round ${startAt}`, 'game_event', 
      {txId: result.transaction.txID(), txType: 'CREATE', agentName: dealer.name})
    console.log(`Session ${sessionId} created with config:`, this.sessionConfig)

    // Initialize pot to 0 (since no agent has paid yet)
    const initialPot = Number(this.participationAmount.microAlgos) * 0 / 1_000_000
    this.stateUpdater({ pot: initialPot })

    // Wait until start round
    await this.waitUntilRound(startAt)
    return result.return!
  }

  /**
   * COMMIT phase: agents send the hash of their choice
   */
  async commit(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    this.log(`\n--- PHASE 1: COMMIT ---`, 'system')
    console.log(`Starting commit phase for session ${sessionId} with agents:`, agents.map(a => a.name))

    // Calculate total pot (participation fee * number of agents)
    const currentPot = Number(this.participationAmount.microAlgos) * agents.length / 1_000_000
    this.stateUpdater({ pot: currentPot })

    for (const agent of agents) {
      this.stateUpdater({
        agents: {
          [agent.name]: { status: 'thinking' }
        }
      })
      this.log(`[${agent.name}] Calculating optimal guess...`, 'thought')

      // Build prompt for agent and get decision
      const prompt = this.buildGamePrompt(agent, sessionNumber)
      const decision = await agent.playRound(this.name, prompt)

      // Validate and normalize choice to 0-100 range
      let safeChoice = Math.round(decision.choice)
      if (safeChoice < 0 || safeChoice > 100) {
        this.log(
          `[${agent.name}] ⚠️ Invalid choice ${safeChoice}. Clamping to range 0-100.`,
          'system'
        )
        console.warn(`Agent ${agent.name} provided invalid choice ${safeChoice}. Clamping to 0-100.`)
      }
      safeChoice = Math.max(0, Math.min(100, safeChoice))

      // Generate random salt and save secret
      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), {
        choice: safeChoice,
        salt,
      })

      this.stateUpdater({
        agents: {
          [agent.name]: { 
            status: 'decided',
            choice: safeChoice
          }
        }
      })
      
      const hash = this.getHash(safeChoice, salt)
      const payment = await this.algorand.createTransaction.payment({
        sender: agent.account.addr,
        receiver: this.appClient!.appAddress,
        amount: this.participationAmount,
      })
      
      const result = await this.appClient!.send.joinSession({
        args: { sessionId, commit: hash, payment },
        sender: agent.account.addr,
        signer: agent.signer,
        suppressLog: true,
      })
      this.log(`[${agent.name}] Committed: ${safeChoice}`, 'action', {txId: result.transaction.txID(), txType: 'COMMIT', agentName: agent.name})
    }
  }

  /**
   * Builds agent prompt with game rules, current state, and strategic hints
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
Entry fee: 1 ALGO
`.trim()

    // Add historical information if available
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
   * REVEAL phase: agents reveal their choice and salt
   */
  async reveal(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 2: REVEAL ---`, 'system')
    console.log(`Starting reveal phase for session ${sessionId}`)
    
    await this.waitUntilRound(this.sessionConfig.endCommitAt + 1n)

    for (const agent of agents) {
        const secret = this.roundSecrets.get(agent.account.addr.toString())
        if (!secret) continue // Skip agents who didn't commit

        this.stateUpdater({
          agents: {
            [agent.name]: { status: 'revealing' }
          }
        })

        try {
          const result = await this.appClient!.send.revealMove({
            args: {
              sessionId,
              choice: BigInt(secret.choice),
              salt: Buffer.from(secret.salt),
            },
            sender: agent.account.addr,
            signer: agent.signer,
            suppressLog: true,
          })
          this.log(`[${agent.name}] Revealed Choice: ${secret.choice}`, 'game_event', {txId: result.transaction.txID(), txType: 'REVEAL', agentName: agent.name})
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
   * RESOLVE phase: empty in this implementation
   * (Resolution happens on-chain during claim phase)
   */
  async resolve(dealer: Agent, sessionId: bigint, sessionNumber: number): Promise<void> {
    return
  }

  /**
   * CLAIM phase: agents claim winnings and contract determines winner
   */
  async claim(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    this.log(`\n--- PHASE 3: CLAIM ---`, 'system')
    console.log(`Starting claim phase for session ${sessionId}`)
    
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    const currentRoundChoices: number[] = []
    agents.forEach((agent) => {
      const secret = this.roundSecrets.get(agent.account.addr.toString())
      if (secret) currentRoundChoices.push(secret.choice)
    })

    if (currentRoundChoices.length > 0) {
      const sum = currentRoundChoices.reduce((a, b) => a + b, 0)
      const avg = sum / currentRoundChoices.length
      const target = avg * (2 / 3)

      // Save statistics for future rounds
      this.roundHistory.push({ avg, target })
      this.log(`📊 Game Stats: Avg=${avg.toFixed(1)}, Target=${target.toFixed(1)}`, 'game_event')
      console.log(`Session ${sessionId} stats - Average: ${avg.toFixed(1)}, Target: ${target.toFixed(1)}`)
    }

    // Each agent attempts to claim winnings
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
          suppressLog: true,
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        
        if (outcome === 'WIN') {
            this.log(`🏆 ${agent.name} WINS! Profit: +${netProfitAlgo.toFixed(2)} ALGO`, 'game_event', {txId: result.transaction.txID(), txType: 'CLAIM', agentName: agent.name})
            console.log(`Agent ${agent.name} won ${netProfitAlgo.toFixed(2)} ALGO`)
        }
      } catch (e: any) {
        this.log(`💸 ${agent.name} LOSES. Loss: ${netProfitAlgo.toFixed(2)} ALGO`, 'game_event')
        console.log(`Agent ${agent.name} lost ${Math.abs(netProfitAlgo).toFixed(2)} ALGO`)
        outcome = 'LOSS'
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
   * Uses spam transactions to advance rounds in local environment 
   * or simply wait in test environment
   */
  private async waitUntilRound(targetRound: bigint) {
    const status = (await this.algorand.client.algod.status().do()) as any
    let currentRound = BigInt(status['lastRound'])

    if (currentRound >= targetRound) return

    const isTestNet = process.env.ALGOD_NETWORK === 'testnet';

    if (isTestNet) {
      console.log(`⏳ Waiting for TestNet round ${targetRound} (Current: ${currentRound})...`);
      this.log(`⏳ Waiting for TestNet round ${targetRound} (Current: ${currentRound})...`)     
      while (currentRound < targetRound) {
        const nextStatus = await this.algorand.client.algod.statusAfterBlock(Number(currentRound)).do();
        currentRound = BigInt(nextStatus['lastRound']);
        process.stdout.write('.'); 
      }
      console.log(" Done.");
    } else {
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
}