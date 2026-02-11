/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import algosdk, { Account, Address } from 'algosdk'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { z } from 'zod'
import { PirateGameClient, PirateGameFactory } from '../../smart_contracts/artifacts/pirateGame/PirateGameClient'
import { Agent } from '../Agent'
import { BaseDecisionSchema } from '../llm'
import { IMultiRoundGameAdapter } from './IMultiRoundGameAdapter'
import { GameLogger } from './IBaseGameAdapter'

/**
 * Extended Zod Schema for Pirate Proposals.
 * Requires a 'distribution' array containing the percentage/amount for each pirate.
 */
const PirateProposalSchema = BaseDecisionSchema.extend({
  distribution: z.array(z.coerce.number()),
})

/**
 * Interface representing a round secret (vote and salt)
 * Used to generate the hash during the commit phase
 */
interface RoundSecret {
  vote: number
  salt: string
}

/**
 * Tracks the local state of a pirate during the simulation.
 */
interface PirateInfo {
  agent: Agent
  seniorityIndex: number // 0 = Most Senior (First Proposer)
  alive: boolean
  finalized: boolean // True if the result has been recorded in agent history
  role?: 'proposer' | 'voter'
}

/**
 * Adapter for the "Pirate Game" (Ultimatum Game variant).
 * 
 * Game Mechanics:
 * 1. Pirates are ranked by seniority (0 to N).
 * 2. The most senior pirate (Proposer) proposes a distribution of the pot.
 * 3. All alive pirates vote (Yes/No).
 * 4. If >= 50% vote Yes: Proposal passes, game ends, funds distributed.
 * 5. If < 50% vote Yes: Proposer is eliminated (killed), pot stays, next senior becomes Proposer.
 * 
 * This class manages the complex multi-round state, proposal validation, and agent interactions.
 * It implements the IMultiRoundGameAdapter interface for handling games with multiple negotiation rounds.
 */
export class PirateGame implements IMultiRoundGameAdapter {
  /** Game identifier name */
  readonly name = 'PirateGame'

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
      this.stateUpdater = updater;
  }

  /** Algorand client for blockchain interaction */
  private algorand = AlgorandClient.defaultLocalNet()
  /** Factory for smart contract deployment */
  private factory: PirateGameFactory | null = null
  /** Client to interact with deployed smart contract */
  private appClient: PirateGameClient | null = null

  /** Participation fee for the game (10 ALGO) */
  private participationAmount = AlgoAmount.Algos(10)
  /** Array tracking all pirates with their local state */
  private pirates: PirateInfo[] = []
  /** Map of agents' vote secrets for current round (addr -> RoundSecret) */
  private roundSecrets: Map<string, RoundSecret> = new Map()

  /** Configuration of current session (timing based on Algorand rounds) */
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null
  /** Current proposal distribution in microAlgos (for internal tracking) */
  private currentProposalDistribution: bigint[] = []
  /** Current internal round number (for state tracking) */
  private currentInternalRound = 0

  /**
   * Game phase duration parameters (expressed in Algorand rounds)
   * - warmUp: wait time before game starts
   * - commitPhase: duration of commit phase for voting
   * - revealPhase: duration of reveal phase for voting
   */
  private durationParams = {
    warmUp: 50n,
    commitPhase: 70n,
    revealPhase: 50n,
  }

  /**
   * Returns the theoretical maximum number of rounds (eliminations) possible.
   */
  async getMaxTotalRounds(): Promise<number> {
    return this.pirates.length - 1
  }

  /**
   * Deploys the smart contract on Algorand
   */
  async deploy(admin: Account, suffix: string = ''): Promise<void> {
    const appName = `PirateGame${suffix}`; 

    const signer = algosdk.makeBasicAccountTransactionSigner(admin)
        
    this.factory = this.algorand.client.getTypedAppFactory(PirateGameFactory, {
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

    await this.algorand.account.ensureFundedFromEnvironment(
        appClient.appAddress, 
        AlgoAmount.Algos(5)
    )

    const action = result.operationPerformed === 'create' ? 'Created new' : 'Reusing existing';
    this.log(`${action} contract: ${appName} (AppID: ${appClient.appId})`)
  }


  /**
   * Initializes the game session on-chain.
   * Sets up the timeframe for the *first* round. Subsequent rounds are managed by the contract logic.
   */
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error('Deploy first!')

    this.pirates = []
    this.roundSecrets.clear()
    this.currentProposalDistribution = []

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
        maxPirates: 20n, // Maximum number of pirates allowed in the game
      },
      sender: dealer.account.addr,
      signer: dealer.signer,
      suppressLog: true,
    })
    
    const sessionId = Number(result.return) + 1
    console.log(`Session ${sessionId} created. Start: round ${startAt}`)
    this.log(`Session ${sessionId} created. Start: round ${startAt}`)

    this.stateUpdater({ pot: 0, pirateData: { captain: 'None', aliveCount: 0 } })
    return result.return!
  }

  /**
   * Shuffles the agent list to ensure random assignment of Seniority Indices.
   */
  private shuffleAgents(agents: Agent[]): Agent[] {
    const shuffled = [...agents]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    return shuffled
  }

  /**
   * Registers all agents into the session.
   * Assigns seniority based on the shuffled order (Index 0 = Senior).
   */
  async setup(agents: Agent[], sessionId: bigint): Promise<void> {
    // Shuffle agents to randomize seniority
    agents = this.shuffleAgents(agents)
    
    const joinMbr = (await this.appClient!.send.getRequiredMbr({ args: { command: 'join' }, suppressLog: true }))
      .return!

    this.log(`🏴‍☠️ Recruiting crew...`, 'game_event')

    // Register each agent as a pirate
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      await this.safeSend(
        () =>
          this.appClient!.send.registerPirate({
            args: {
              sessionId,
              payment: this.algorand.createTransaction.payment({
                sender: agent.account.addr,
                receiver: this.appClient!.appAddress,
                amount: this.participationAmount,
              }),
              mbrPayment: this.algorand.createTransaction.payment({
                sender: agent.account.addr,
                receiver: this.appClient!.appAddress,
                amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
              }),
            },
            sender: agent.account.addr,
            signer: agent.signer,
            suppressLog: true,
          }),
        'Register Pirate',
      )

      // Track pirate in local state
      this.pirates.push({
        agent,
        seniorityIndex: i,
        alive: true,
        finalized: false,
      })
      console.log(`[${agent.name}] Registered as Pirate #${i}`)
      this.log(`[${agent.name}] Registered as Pirate #${i}`, 'game_event')
    }

    // Update frontend with initial state (no captain yet, pot is 0)
    this.updateFrontendState(0, 0);
    
    await this.waitUntilRound(this.sessionConfig!.startAt + 1n)
    console.log(`\n🏴‍☠️ Game Started! ${agents.length} pirates ready to negotiate...`)
    this.log(`\n🏴‍☠️ Game Started! ${agents.length} pirates ready to negotiate...`)
  }

  /**
   * Executes a single negotiation round (Proposal -> Commit -> Reveal -> Execute).
   */
  async playRound(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<boolean> {
    const activeProposerIndex = roundNumber - 1; 
    
    // Sync alive status from contract (in case of previous eliminations)
    await this.syncPirateStatus(sessionId)

    // Get current game state and configuration
    const state = await this.appClient!.state.box.gameState.value(sessionId)
    let config = await this.appClient!.state.box.gameSessions.value(sessionId)
    if (!state || !config) throw new Error('Game state/config not found')

    // Log round information
    console.log(`\n┌─────────────────────────────────────`)
    console.log(`│ 🔄 Round ${roundNumber} | Phase: ${this.getPhaseName(Number(state.phase))}`)
    console.log(`│ 👥 Alive: ${state.alivePirates}/${state.totalPirates}`)
    console.log(`│ 💰 Pot: ${Number(state.pot) / 1_000_000} ALGO`)
    console.log(`└─────────────────────────────────────`)

    this.log(`\n┌─────────────────────────────────────`)
    this.log(`│ 🔄 Round ${roundNumber} | Phase: ${this.getPhaseName(Number(state.phase))}`)
    this.log(`│ 👥 Alive: ${state.alivePirates}/${state.totalPirates}`)
    this.log(`│ 💰 Pot: ${Number(state.pot) / 1_000_000} ALGO`)
    this.log(`└─────────────────────────────────────`)

    this.updateFrontendState(Number(state.pot), activeProposerIndex);

    if (state.phase === 4n) {
      console.log('\n🎉 GAME FINISHED!')
      this.log('\n🎉 GAME FINISHED!', 'game_event')
      await this.recordRoundResults(sessionId, roundNumber)
      return false
    }

    // === PHASE 1: PROPOSAL ===
    if (state.phase === 1n || (state.phase === 0n && roundNumber === 1)) {
      await this.handleProposalPhase(sessionId, state, roundNumber)
      config = await this.appClient!.state.box.gameSessions.value(sessionId)
    }

    // === PHASE 2: VOTE COMMIT ===
    const freshState = await this.appClient!.state.box.gameState.value(sessionId)
    if (freshState && freshState.phase === 2n) {
      await this.commit(agents, sessionId, roundNumber)
      await this.waitUntilRound(config!.endCommitAt + 1n)
    }

    // === PHASE 3: VOTE REVEAL ===
    const revealState = await this.appClient!.state.box.gameState.value(sessionId)
    if (revealState && (revealState.phase === 3n || revealState.phase === 2n)) {
      await this.reveal(agents, sessionId, roundNumber)
      await this.waitUntilRound(config!.endRevealAt + 1n)
    }

    // === EXECUTE ROUND ===
    console.log(`\n⚙️  EXECUTING ROUND...`)
    this.log(`\n⚙️  Counting votes...`, 'system')
    await this.safeSend(
      () =>
        this.appClient!.send.executeRound({
          args: { sessionId },
          sender: agents[0].account.addr, // Use first agent as executor (anyone can call)
          signer: agents[0].signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
          suppressLog: true,
        }),
      'Execute Round',
    )

    await this.syncPirateStatus(sessionId)

    await this.recordRoundResults(sessionId, roundNumber)

    // Check if game is over
    const post = await this.appClient!.state.box.gameState.value(sessionId)
    return post?.phase == 4n
  }

  /**
   * Updates the frontend state with current game information
   */
  private updateFrontendState(potMicroAlgo: number, captainIndex: number) {
      const captain = this.pirates.find(p => p.seniorityIndex === captainIndex)?.agent.name || 'None';
      const aliveList = this.pirates.filter(p => p.alive).map(p => p.agent.name);
      
      this.stateUpdater({
          pot: potMicroAlgo / 1_000_000,
          pirateData: {
              captain: captain,
              alivePirates: aliveList, // Pass the list of names for Agent Matrix
              aliveCount: aliveList.length
          }
      });
  }

  /**
   * FINALIZE: Cleanup method (mostly a placeholder for logging).
   */
  async finalize(agents: Agent[], sessionId: bigint): Promise<void> {
    const state = await this.appClient!.state.box.gameState.value(sessionId)
    if (!state || state.phase !== 4n) return

    console.log('\n🏁 GAME FINISHED')
    this.log('\n🏁 GAME FINISHED', 'game_event')
  }

  /**
   * COMMIT PHASE: All alive pirates vote on the current proposal.
   * Proposer automatically votes YES. Others consult the LLM.
   */
  async commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    console.log(`\n🗳️  VOTE COMMIT PHASE`)
    this.log(`\n🗳️  Vote Commit Phase: Pirates are submitting their votes...`, 'game_event')
    const state = await this.appClient!.state.box.gameState.value(sessionId)
    if (!state) throw new Error('State not found')
    
    const commitMbr = (
      await this.appClient!.send.getRequiredMbr({
        args: { command: 'commitVote' },
        suppressLog: true,
      })
    ).return!

    const proposal = await this.appClient!.state.box.proposals.value(sessionId)
    if (!proposal) throw new Error('No proposal found')

    this.roundSecrets.clear()

    // Each alive pirate commits their vote
    for (const pirate of this.pirates) {
      if (!pirate.alive) continue

      let vote = 0

      // Auto-vote YES for proposer (Self-preservation)
      if (pirate.seniorityIndex === Number(state!.currentProposerIndex)) {
        console.log(`[${pirate.agent.name}] is Proposer → Auto-voting YES`)
        this.log(`[${pirate.agent.name}] is Proposer → Auto-voting YES`, 'system')
        vote = 1
        pirate.role = 'proposer'
      } else {
        pirate.role = 'voter'
        // Get vote decision from LLM
        const prompt = this.buildVoterPrompt(pirate.agent, state, proposal, roundNumber)
        const decision = await pirate.agent.playRound(this.name, prompt)
        vote = decision.choice
      }

      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(pirate.agent.account.addr.toString(), { vote, salt })

      await this.safeSend(
        () =>
          this.appClient!.send.commitVote({
            args: {
              sessionId,
              voteHash: new Uint8Array(this.getHash(vote, salt)),
              mbrPayment: this.algorand.createTransaction.payment({
                sender: pirate.agent.account.addr,
                receiver: this.appClient!.appAddress,
                amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
              }),
            },
            sender: pirate.agent.account.addr,
            signer: pirate.agent.signer,
            suppressLog: true,
          }),
        `Vote ${pirate.agent.name}`,
      )
    }
  }

  /**
   * REVEAL PHASE: Pirates reveal their committed votes.
   */
  async reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    console.log(`\n🔓 VOTE REVEAL PHASE`)
    this.log(`\n🔓 Vote Reveal Phase: Pirates are revealing their votes...`, 'game_event')
    for (const pirate of this.pirates) {
      if (!pirate.alive) continue

      const secret = this.roundSecrets.get(pirate.agent.account.addr.toString())
      if (!secret) continue

      await this.safeSend(
        () =>
          this.appClient!.send.revealVote({
            args: {
              sessionId,
              vote: BigInt(secret.vote),
              salt: Buffer.from(secret.salt),
            },
            sender: pirate.agent.account.addr,
            signer: pirate.agent.signer,
            suppressLog: true,
          }),
        `Reveal ${pirate.agent.name}`,
      )

      console.log(`[${pirate.agent.name}] Revealed: ${secret.vote === 1 ? 'YES' : 'NO'}`)
      this.log(`[${pirate.agent.name}] Revealed: ${secret.vote === 1 ? 'YES' : 'NO'}`, 'system')
    }
  }

  // No explicit resolve call needed for this game logic
  async resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void> {
    return
  }

  /**
   * CLAIM PHASE: Distributes the pot if the game is over.
   */
  async claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    console.log('\n--- PHASE 4: CLAIM WINNINGS (Payout) ---')
    this.log('\n--- PHASE 4: CLAIM WINNINGS (Payout) ---', 'game_event')
    
    // 1. Retrieve final proposal from contract
    const proposal = await this.appClient!.state.box.proposals.value(sessionId)
    if (!proposal) {
      console.log('⚠️ No proposal found. Nothing to claim.')
      this.log('⚠️ No proposal found. Nothing to claim.', 'system')
      return
    }

    // 2. Parse final distribution (Array of BigInt)
    const state = await this.appClient!.state.box.gameState.value(sessionId)
    const finalAmounts = this.parseDistributionFromBytes(proposal.distribution, Number(state!.totalPirates))

    // 3. Each pirate claims their winnings
    for (const pirate of this.pirates) {
      if (!pirate.alive) continue

      const coins = finalAmounts[pirate.seniorityIndex]
      const winnings =  (Number(coins) / 1_000_000) - this.participationAmount.algo
      
      if (winnings > 0) {
        console.log(`💰 [${pirate.agent.name}] Claiming ${(Number(coins) / 1_000_000).toFixed(2)} ALGO - Profit: +${Number(winnings).toFixed(2)} ALGO...`)
        this.log(`💰 [${pirate.agent.name}] Claiming ${(Number(coins) / 1_000_000).toFixed(2)} ALGO - Profit: +${Number(winnings).toFixed(2)} ALGO...`, 'game_event')
        await this.safeSend(
          () =>
            this.appClient!.send.claimWinnings({
              args: { sessionId },
              sender: pirate.agent.account.addr,
              signer: pirate.agent.signer,
              coverAppCallInnerTransactionFees: true,
              maxFee: AlgoAmount.MicroAlgo(3000),
              suppressLog: true,
            }),
          `Claim ${pirate.agent.name}`,
        )
      } else if (winnings === 0) {
        console.log(`⚖️ [${pirate.agent.name}] No winnings to claim (0 ALGO)`)
        this.log(`⚖️ [${pirate.agent.name}] No winnings to claim (0 ALGO)`, 'game_event')
      } else {
        console.log(`[${pirate.agent.name}] YOU LOSE! - Loss: ${Number(winnings).toFixed(2) } ALGO...`)
        this.log(`💸 [${pirate.agent.name}] YOU LOSE! - Loss: ${Number(winnings).toFixed(2) } ALGO...`, 'game_event') 
      }
    }
  }

  // === PROMPTS & PROPOSAL LOGIC ===

  /**
   * Constructs the prompt for the Proposer.
   * Critical Logic: Maps the "local" array of ALIVE pirates to the "global" array required by the contract.
   * Uses an error feedback loop if the LLM produces invalid distributions (wrong sum/length).
   */
  private buildProposerPrompt(
    agent: Agent,
    state: any,
    round: number,
    proposerIndex: number,
    errorFeedback: string = '',
  ): string {
    const potAlgo = Number(state.pot) / 1_000_000
    const alivePirates = this.pirates.filter((p) => p.alive)
    const aliveCount = alivePirates.length
    const votesNeeded = Math.ceil(aliveCount / 2)

    // Find local index for LLM instruction
    const localProposerIndex = alivePirates.findIndex((p) => p.seniorityIndex === proposerIndex)

    const mappingString = alivePirates
      .map((p, i) => `Index [${i}] -> Pirate #${p.seniorityIndex}${p.seniorityIndex === proposerIndex ? ' (YOU)' : ''}`)
      .join('\n')

    return `
You are ${agent.name}. 
Personality: ${agent.profile.personalityDescription}

=== PIRATE GAME – PROPOSAL PHASE (Round ${round}) ===

OBJECTIVE:
You are the CAPTAIN. Propose a distribution that PASSES (needs ${votesNeeded} YES votes, including yours) and maximizes your profit. 
If it fails, you DIE.

GAME DATA:
- Total pot: ${potAlgo} ALGO.
- Active Pirates (Alive): ${aliveCount}.
- Your Global Identity: Pirate #${proposerIndex}.

### IMPORTANT: ARRAY MAPPING (ONLY ${aliveCount} ELEMENTS)
Your "distribution" array MUST have exactly ${aliveCount} elements. 
Use this mapping to assign percentages:
${mappingString}

### STRATEGY:
- To pay YOURSELF, assign money to Index [${localProposerIndex}].
- To buy votes from others, assign money to their corresponding local indices.
- Global Indices lower than #${proposerIndex} are already DEAD and removed from this list. Do not worry about them.

### TECHNICAL REQUIREMENTS:
1. "distribution" array length: EXACTLY ${aliveCount}.
2. Sum of all elements: EXACTLY 100.
3. Format: JSON only.

${errorFeedback ? `\n⚠️ PREVIOUS ATTEMPT ERROR: ${errorFeedback}\n` : ''}

### RESPONSE FORMAT:
{
  "choice": 1,
  "distribution": [number, number, ...], 
  "reasoning": "Brief strategy explanation."
}

FINAL CHECK: Is your array length ${aliveCount}? If not, the game breaks.
`.trim()
  }

  /**
   * Constructs the prompt for a voting pirate.
   */
  private buildVoterPrompt(agent: Agent, state: any, proposal: any, round: number): string {
    const distribution = this.parseDistributionFromBytes(proposal.distribution, Number(state.totalPirates))

    const me = this.pirates.find((p) => p.agent.name === agent.name)!
    const myIndex = me.seniorityIndex
    const myShare = Number(distribution[myIndex]) / 1_000_000
    const entryCost = Number(this.participationAmount.microAlgos) / 1_000_000
    const netGain = myShare - entryCost

    const proposerIndex = Number(state.currentProposerIndex)
    const proposerShare = Number(distribution[proposerIndex]) / 1_000_000

    return `
You are ${agent.name}.
Personality: ${agent.profile.personalityDescription}

=== PIRATE GAME – VOTING PHASE (Round ${round}) ===

ROLE:
You are a VOTER. You must decide whether to accept or reject the captain's proposal.

GAME RULES (REMINDER):
- If the proposal PASSES:
  - The game ends.
  - You receive your allocated share.
- If the proposal FAILS:
  - The captain (pirate #${proposerIndex}) is eliminated.
  - A new captain will propose next round.
  - You may get a better deal later… or worse.

DEAD PIRATES CHECK:
- Pirates with index LOWER than ${proposerIndex} are DEAD.
- Dead pirates receive 0%.
- This proposal already respects that rule.

YOUR OFFER:
- You receive: ${myShare} ALGO
- Entry cost: ${entryCost} ALGO
- Net result if accepted: ${netGain.toFixed(2)} ALGO

CAPTAIN INCENTIVE:
- Captain receives: ${proposerShare} ALGO

DECISION GUIDELINES:
- Voting YES gives you a guaranteed outcome now.
- Voting NO kills the captain but risks uncertainty.
- Consider:
  - Is your net gain positive?
  - Is the captain being excessively greedy?
  - Would you likely do better if you become captain later?

PROPOSAL SUMMARY:
${distribution
  .map((amt, idx) => {
    const name = this.pirates.find((p) => p.seniorityIndex === idx)?.agent.name
    return `- Pirate #${idx} (${name}): ${Number(amt) / 1_000_000} ALGO`
  })
  .join('\n')}

RESPONSE FORMAT (JSON ONLY):
{
  "choice": 1 or 0,
  "reasoning": "Explain why you vote YES or NO based on risk, reward, and future expectations."
}
`.trim()
  }

  // === HELPER METHODS ===

  /**
   * Creates a fallback distribution where proposer takes everything (100%)
   */
  private buildFallbackDistribution(totalPirates: number, proposerIndex: number): number[] {
    const percentages = new Array(totalPirates).fill(0)
    percentages[proposerIndex] = 100
    return percentages
  }

  /**
   * Waits until Algorand blockchain reaches a specific round
   * Uses spam transactions to advance rounds in test environment
   */
  private async waitUntilRound(targetRound: bigint) {
    const status = (await this.algorand.client.algod.status().do()) as any
    const currentRound = BigInt(status['lastRound'])
    if (currentRound >= targetRound) return
    
    const blocks = Number(targetRound - currentRound)
    const spammer = await this.algorand.account.random()
    await this.algorand.account.ensureFundedFromEnvironment(spammer.addr, AlgoAmount.Algos(1))
    
    for (let i = 0; i < blocks; i++) {
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

  /**
   * Orchestrates the Proposal Phase using a retry loop for LLM failures.
   * Maps LLM's short distribution array (alive pirates only) to the full contract array.
   */
  private async handleProposalPhase(sessionId: bigint, state: any, roundNumber: number): Promise<void> {
    const proposerIndex = Number(state.currentProposerIndex)
    const proposer = this.pirates.find((p) => p.seniorityIndex === proposerIndex)

    if (!proposer || !proposer.alive) {
      console.error(`❌ Proposer #${proposerIndex} not found or dead!`)
      this.log(`❌ Proposer #${proposerIndex} not found or dead!`, 'system')
      throw new Error(`Invalid proposer #${proposerIndex}`)
    }

    proposer.role = 'proposer'

    console.log(`\n📋 PROPOSAL PHASE`)
    this.log(`\n📋 Proposal Phase: Pirate #${proposerIndex} (${proposer.agent.name}) is proposing...`, 'game_event')
    console.log(`Proposer: ${proposer.agent.name} (Pirate #${proposerIndex})`)
    this.log(`Proposer: ${proposer.agent.name} (Pirate #${proposerIndex})`, 'system')

    const alivePirates = this.pirates.filter((p) => p.alive)
    const totalPot = Number(state.pot)
    const totalPirates = Number(state.totalPirates)

    let attempts = 0
    const maxAttempts = 10
    let finalDistributionBuffer: Uint8Array | null = null
    let errorFeedback = ''

    let response = {
      choice: 1,
      reasoning: 'Default greedy proposal',
      distribution: this.buildFallbackDistribution(Number(state.totalPirates), proposerIndex),
    }
    
    proposer.agent.clearPendingDecisions()
    
    // Retry loop for LLM proposal generation
    while (attempts < maxAttempts && !finalDistributionBuffer) {
      try {
        const prompt = this.buildProposerPrompt(proposer.agent, state, roundNumber, proposerIndex, errorFeedback)
        response = await proposer.agent.playRound(this.name, prompt, PirateProposalSchema)
        response.choice = 1
        const shortDist = response.distribution || []
        const fullDistPercentages = this.expandDistribution(shortDist, totalPirates);

        const fullDistMicroAlgos = this.calculateMicroAlgoDistribution(
            fullDistPercentages, 
            totalPot, 
            totalPirates, 
            proposerIndex
        );

        const deadWithMoney = fullDistMicroAlgos.some((amt, idx) => !this.pirates[idx].alive && amt > 0);
        if (deadWithMoney) throw new Error("Assigned money to dead pirates.");

        finalDistributionBuffer = this.convertToBuffer(fullDistMicroAlgos);
        break;

      } catch (e: any) {
        attempts++
        proposer.agent.clearPendingDecisions()
        const currentDist = response && response.distribution ? JSON.stringify(response.distribution) : 'null'
        errorFeedback = `
        [SYSTEM ERROR - ATTEMPT ${attempts}]:
Your last distribution was: ${currentDist}
Error Detail: ${e.message}
CORRECTION PROTOCOL:
1. Count the elements: must be EXACTLY ${state.totalPirates}.
2. Check the sum: sum(elements) must be EXACTLY 100.
3. Dead Pirates: Indices < ${proposerIndex} MUST be 0.
Current Status: ${this.pirates.map((p) => `#${p.seniorityIndex}:${p.alive ? 'Alive' : 'DEAD'}`).join(', ')}
`.trim()
        console.warn(`[DEBUG] Proposal rejected (Attempt ${attempts}): ${e.message}`)
        if (attempts >= maxAttempts) {
          console.error('❌ Max attempts reached. Using fallback distribution.')
          response = {
            choice: 1,
            distribution: this.buildFallbackDistribution(Number(state.totalPirates), proposerIndex),
            reasoning: 'LLM failed all logic checks.',
          }
        }
      }
    }
    
    // If all attempts failed, use greedy fallback
    if (!finalDistributionBuffer) {
        console.error('❌ Max attempts reached. Using greedy fallback.')
        const fallbackMicroAlgos = new Array(totalPirates).fill(0);
        fallbackMicroAlgos[proposerIndex] = totalPot; 
        finalDistributionBuffer = this.convertToBuffer(fallbackMicroAlgos);
    }

    this.currentProposalDistribution = this.parseDistributionFromBytes(finalDistributionBuffer, totalPirates)

    console.log(`\n💡 ${proposer.agent.name} proposes:`)
    this.log(`\n💡 ${proposer.agent.name} proposes:`, 'system')
    this.logDistribution(finalDistributionBuffer, totalPirates);

    await this.safeSend(
      () =>
        this.appClient!.send.proposeDistribution({
          args: { sessionId, distribution: finalDistributionBuffer! },
          sender: proposer.agent.account.addr,
          signer: proposer.agent.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
          suppressLog: true,
        }),
      'Propose Distribution',
    )
  }

  /**
   * Converts an array of numbers to a Uint8Array buffer
   */
  private convertToBuffer(amounts: number[]): Uint8Array {
    const buffer = Buffer.alloc(amounts.length * 8)
    amounts.forEach((amt, idx) => {
      buffer.writeBigUInt64BE(BigInt(amt), idx * 8)
    })
    return buffer
  }

  /**
   * Synchronizes local pirate alive status with on-chain state
   */
  private async syncPirateStatus(sessionId: bigint): Promise<void> {
    for (const pirate of this.pirates) {
      if (!pirate.alive) continue

      const pirateKey = this.getPirateKeySync(sessionId, pirate.agent.account.addr.toString())
      try {
        const pirateData = await this.appClient!.state.box.pirates.value(pirateKey)
        if (pirateData && !pirateData.alive) {
          console.log(`💀 [${pirate.agent.name}] eliminated`)
          this.log(`💀 [${pirate.agent.name}] eliminated`, 'game_event')
          pirate.alive = false
        }
      } catch (e) {}
    }
  }

  /**
   * Records round results for all agents and updates their internal statistics
   */
  private async recordRoundResults(sessionId: bigint, roundNumber: number): Promise<void> {
    const postState = await this.appClient!.state.box.gameState.value(sessionId)
    const proposal = await this.appClient!.state.box.proposals.value(sessionId)

    if (!postState || !proposal) return

    const proposalAccepted = postState.phase === 4n
    const distribution = this.parseDistributionFromBytes(proposal.distribution, Number(postState.totalPirates))

    for (const pirate of this.pirates) {
      if (pirate.finalized) continue

      let result = 'SURVIVED'
      let profit = 0

      if (proposalAccepted) {
        const share = Number(distribution[pirate.seniorityIndex])
        const entry = Number(this.participationAmount.microAlgos)
        profit = (share - entry) / 1_000_000
        result = profit >= 0 ? 'WIN' : 'LOSS'
      } else if (!pirate.alive) {
        result = 'ELIMINATED'
        profit = -Number(this.participationAmount.microAlgos) / 1_000_000
      } else {
        result = 'SURVIVED'
        profit = 0
      }

      await pirate.agent.finalizeRound(this.name, result, profit, Number(sessionId), roundNumber, {
        role: pirate.role,
        proposalAccepted,
      })
      pirate.finalized = true
    }
    
    // Reset finalized flag for next round if proposal was rejected
    if (!proposalAccepted) {
      this.pirates.forEach((p) => {
        if (p.alive) p.finalized = false
      })
    }
  }

  /**
   * Expands a short distribution array (for alive pirates only) to full length array
   */
  private expandDistribution(shortDist: number[], totalPirates: number): number[] {
    const fullDist = new Array(totalPirates).fill(0)
    let shortIdx = 0

    for (let i = 0; i < totalPirates; i++) {
      if (this.pirates[i].alive) {
        fullDist[i] = shortDist[shortIdx] || 0
        shortIdx++
      } else {
        fullDist[i] = 0
      }
    }
    return fullDist
  }

  /**
   * Calculates the exact MicroAlgo distribution for a given pot based on raw percentage values.
   *
   * This method performs the following operations:
   * 1. Validates that the input array length matches the expected number of pirates.
   * 2. Normalizes the input values to ensure they represent a valid ratio relative to the sum.
   * 3. Converts the ratios into integer MicroAlgo amounts using floor rounding.
   * 4. Allocates any remaining "dust" (remainder from rounding down) to the proposer 
   * to ensure the total allocated amount exactly matches the total pot.
   */
  private calculateMicroAlgoDistribution(
  percentages: number[], 
  totalPot: number, 
  totalPirates: number, 
  proposerIndex: number
): number[] {
  if (percentages.length !== totalPirates) {
      throw new Error(`Length mismatch: expected ${totalPirates}, got ${percentages.length}`);
  }

  const sum = percentages.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error('Total sum cannot be 0');

  let currentAllocated = 0;
  const amounts = percentages.map((pct) => {
    const amount = Math.floor(((pct / sum) * 100 / 100) * totalPot); 
    currentAllocated += amount;
    return amount;
  });

  const remainder = totalPot - currentAllocated;
  if (remainder > 0) {
    if (proposerIndex >= 0 && proposerIndex < totalPirates) {
       amounts[proposerIndex] += remainder;
    } else {
       amounts[0] += remainder; 
    }
  }
  return amounts;
}

  /**
   * Parses distribution from bytes to array of bigints
   */
  private parseDistributionFromBytes(bytes: Uint8Array, totalPirates: number): bigint[] {
    const result: bigint[] = []
    const buffer = Buffer.from(bytes)
    for (let i = 0; i < totalPirates; i++) {
      result.push(buffer.readBigUInt64BE(i * 8))
    }
    return result
  }

  /**
   * Logs the distribution to console and game log
   */
  private logDistribution(dist: Uint8Array, totalPirates: number) {
    const buffer = Buffer.from(dist)
    for (let i = 0; i < totalPirates; i++) {
      const amount = buffer.readBigUInt64BE(i * 8)
      const pirate = this.pirates.find((p) => p.seniorityIndex === i)
      const status = pirate?.alive ? '🟢' : '💀'
      console.log(`  ${status} Pirate #${i} (${pirate?.agent.name}): ${(Number(amount) / 1_000_000).toFixed(2)} ALGO`)
      this.log(`  ${status} Pirate #${i} (${pirate?.agent.name}): ${(Number(amount) / 1_000_000).toFixed(2)} ALGO`, 'system')
    }
  }

  /**
   * Generates the key for accessing pirate data in contract storage
   */
  private getPirateKeySync(sessionId: bigint, address: string): Uint8Array {
    const sessionIdBytes = Buffer.alloc(8)
    sessionIdBytes.writeBigUInt64BE(sessionId)
    const addressBytes = algosdk.decodeAddress(address).publicKey
    return new Uint8Array(
      crypto
        .createHash('sha256')
        .update(Buffer.concat([sessionIdBytes, Buffer.from(addressBytes)]))
        .digest(),
    )
  }

  /**
   * Calculates SHA256 hash of a vote and salt
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
   * Gets phase name from phase number
   */
  private getPhaseName(phase: number): string {
    const names = ['Registration', 'Proposal', 'VoteCommit', 'VoteReveal', 'Finished']
    return names[phase] || 'Unknown'
  }

  /**
   * Safely sends a transaction with error handling
   */
  private async safeSend(action: () => Promise<any>, label: string) {
    try {
      await action()
    } catch (e: any) {
      if (e.message?.includes('transaction already in ledger')) {
        console.log(`⚠️  ${label} already on chain`)
      } else {
        console.error(`❌ ${label} failed:`, e.message)
      }
    }
  }
}