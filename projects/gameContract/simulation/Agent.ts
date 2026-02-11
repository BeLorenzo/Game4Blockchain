/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Account, TransactionSigner } from 'algosdk'
import * as fs from 'fs'
import * as path from 'path'
import { askLLM, BaseDecisionSchema } from './llm'
import { z } from "zod";

/**
 * Defines the static personality traits of an agent.
 * These values (0.0 - 1.0) influence the prompt construction and decision-making logic.
 */
export interface PsychologicalProfile {
  personalityDescription: string
  riskTolerance: number
  trustInOthers: number
  wealthFocus: number
  fairnessFocus: number
  patience: number
  adaptability: number
  resilience: number
  curiosity: number
}

/**
 * Tracks the dynamic emotional state of the agent.
 * Changes based on game results (wins/losses).
 */
export interface AgentMentalState {
  optimism: number
  frustration: number
  consecutiveLosses: number
}

/**
 * Represents a single recorded game event.
 */
export interface Experience {
  game: string
  session: number
  round: number
  choice: number
  result: string
  profit: number
  reasoning: string
  timestamp: string
  role?: string
  proposalAccepted?: boolean
  roundEliminated?: number
}

/**
 * Interface for tracking performance statistics of specific actions (choices) within a game
 */
interface ActionStat {
  timesChosen: number
  totalProfit: number
  wins: number
  losses: number
}

/**
 * Nested mapping structure for game performance statistics:
 * Game Name -> Choice ID -> ActionStat
 */
interface GameStatsMap {
  [gameName: string]: {
    [choiceId: number]: ActionStat
  }
}

/**
 * Represents a decision that has been made but not yet finalized (awaiting game resolution)
 */
interface PendingDecision {
  choice: number
  reasoning: string
  timestamp: number
}

/**
 * Callback type for logging agent thoughts and actions
 */
type LogCallback = (agentName: string, type: 'thought' | 'action', message: string) => void;

/**
 * Represents an AI Agent capable of interacting with Algorand Smart Contracts.
 * 
 * Features:
 * - **Persistence**: Saves/Loads history and learning data to JSON.
 * - **Psychology**: Simulates emotions (frustration, optimism) that affect decision temperature.
 * - **Strategy**: Implements learning from past performance and adapts behavior based on results.
 * 
 * Each agent has:
 * - A psychological profile with static personality traits
 * - A dynamic mental state that changes based on game outcomes
 * - Performance statistics for each game/choice combination
 * - A persistent history of all game experiences
 * 
 * The agent uses LLM for decision-making, guided by its personality, past experiences,
 * and current emotional state.
 */
export class Agent {
  /** Algorand account associated with this agent */
  account: Account
  /** Unique name identifier for the agent */
  name: string
  /** LLM model to use for decision-making */
  model: string
  /** Static psychological profile influencing decision-making */
  profile: PsychologicalProfile
  /** Dynamic emotional state that evolves with game outcomes */
  mentalState: AgentMentalState

  /** Recent game history (cached for quick access) */
  private recentHistory: Experience[] = []
  /** Complete game history across all sessions */
  private fullHistory: Experience[] = []
  /** Performance statistics by game and choice */
  private performanceStats: GameStatsMap = {}
  /** File path for persistent storage of agent state */
  private filePath: string
  
  /** Temporary storage for decisions awaiting game resolution */
  private pendingDecisions: PendingDecision[] = []

  /** Callback function for logging agent thoughts and actions */
  private onLog: LogCallback = () => {}

  /**
   * Creates a new Agent with the specified account, name, profile, and model
   */
  constructor(account: Account, name: string, profile: PsychologicalProfile, model: string) {
    this.account = account
    this.name = name
    this.profile = profile
    this.model = model

    // Initialize mental state with neutral values
    this.mentalState = {
      optimism: 0.5,
      frustration: 0.0,
      consecutiveLosses: 0,
    }

    // Ensure data directory exists
    const dataDir = path.join(__dirname, 'data', 'agents')
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    this.filePath = path.join(dataDir, `${this.name.replace(/\s+/g, '_')}.json`)

    // Load any existing state from disk
    this.loadState() 
  }

  /**
   * Sets the logging callback for the agent
   */
  public setLogger(callback: LogCallback) {
    this.onLog = callback;
  }

  /**
   * Calculates the sampling temperature for the LLM.
   * The temperature controls the randomness/creativity of LLM responses.
   * 
   * Factors influencing temperature:
   * - Base temperature: 0.4
   * - Curiosity: +0.4 * curiosity score (more curious = more random exploration)
   * - Consecutive losses > 3: +0.3 (desperation leads to more risk-taking)
   */
  get dynamicTemperature(): number {
    let temp = 0.4 + (this.profile.curiosity * 0.4);
    if (this.mentalState.consecutiveLosses > 3) temp += 0.3;
    return Math.min(1.0, Math.max(0.1, temp));
  }

  /**
   * Returns a TransactionSigner compatible with AlgoKit/AlgoSDK.
   * This signer can sign transactions using the agent's private key.
   */
  get signer(): TransactionSigner {
    return (txnGroup, indexes) => Promise.resolve(indexes.map((i) => txnGroup[i].signTxn(this.account.sk)))
  }

  /**
   * Core decision-making method that combines game rules, personality, and past experience.
   * 
   * Workflow:
   * 1. Log the thinking process
   * 2. Build comprehensive prompt including personality, history, and current game context
   * 3. Query LLM for decision with dynamic temperature
   * 4. Store decision as pending (awaiting game resolution)
   * 5. Return the decision
   */
  async playRound<T extends z.ZodType<any>>(
    gameName: string, 
    gamePrompt: string,
    schema: T = BaseDecisionSchema as any
  ): Promise<z.infer<T>> {    
    // Log thinking process
    this.onLog(this.name, 'thought', `Analyzing ${gameName}... Temperature: ${this.dynamicTemperature.toFixed(2)}`);
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 1. Build comprehensive prompt with personality, history, and game context
    const fullPrompt = this.buildFullPrompt(gameName, gamePrompt)

    // 2. Query LLM with dynamic temperature
    const decision = await askLLM(fullPrompt, this.model, schema, {
      temperature: this.dynamicTemperature,
    })

    // Log the decision
    this.onLog(this.name, 'action', `Chose Option ${decision.choice}. Reasoning: ${decision.reasoning}...`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log(`[${this.name}] Choice: ${decision.choice}`)
    console.log(`[${this.name}] Reasoning: ${decision.reasoning}\n`)

    this.pendingDecisions.push({
      ...decision,
      timestamp: Date.now()
    })
    
    return decision
  }

  /**
   * Constructs the full context for the LLM by combining:
   * - Game rules and current context
   * - Personality profile and parameters
   * - Historical performance statistics
   * - Recent move history
   * - Current mental/emotional state
   */
  private buildFullPrompt(gameName: string, gamePrompt: string): string {
    const statsSummary = this.getStatsSummary(gameName)
    const recentMoves = this.getRecentHistory(gameName, 5)
    const parameters = this.getProfileSummary()

    return `
You are ${this.name}.

═══════════════════════════════════════════════════════════
GAME RULES AND CONTEXT
═══════════════════════════════════════════════════════════

${gamePrompt}

═══════════════════════════════════════════════════════════
YOUR IDENTITY AND KNOWLEDGE
═══════════════════════════════════════════════════════════

YOUR PERSONALITY:
${this.profile.personalityDescription}

YOUR PARAMETERS:
${parameters}

════════ YOUR MEMORY (${gameName}) ════════
${statsSummary}

YOUR RECENT MOVES IN ${gameName.toUpperCase()}:
${recentMoves}

MENTAL STATE (across ALL games, not just ${gameName}):
- Frustration: ${(this.mentalState.frustration * 10).toFixed(0)}/10
- Consecutive Losses: ${this.mentalState.consecutiveLosses}

Note: You may feel frustrated from other games, but focus on THIS game's data above.

═══════════════════════════════════════════════════════════

Analyze the situation using your personality traits and past experience IN THIS GAME.
Make your decision and explain your reasoning clearly.

Respond ONLY with JSON: {"choice": <number>, "reasoning": "<your explanation>"}
`.trim()
  }

  /**
   * Generates a text summary of performance statistics for a specific game.
   * Shows win rates and profitability for each choice/option.
   */
  public getStatsSummary(game: string): string {
    const stats = this.performanceStats[game]
    if (!stats || Object.keys(stats).length === 0) return 'No previous data for this game.'

    const summary = Object.entries(stats)
      .map(([choice, s]) => {
        const winRate = s.timesChosen > 0 ? ((s.wins / s.timesChosen) * 100).toFixed(0) : '0'
        return `Option ${choice}: Played ${s.timesChosen}x, Won ${winRate}%, Net Profit: ${s.totalProfit.toFixed(1)} ALGO`
      })
      .join('\n')

    return `PERFORMANCE STATS:\n${summary}`
  }

  /**
   * Retrieves the last N moves from history for a specific game.
   */
  public getRecentHistory(game: string, limit: number = 10): string {
    const gameHistory = this.recentHistory.filter((h) => h.game === game).slice(-limit)
    if (gameHistory.length === 0) return '• No recent moves'

    return gameHistory
      .map((h) => {
        const profitStr = h.profit >= 0 ? `+${h.profit.toFixed(1)}` : h.profit.toFixed(1)
        let extra = ''
        if (h.role) extra += ` [${h.role}]`
        if (h.roundEliminated) extra += ` (eliminated R${h.roundEliminated})`
        return `Session ${h.session}-R${h.round}: Choice ${h.choice} → ${profitStr} ALGO${extra}`
      })
      .join('\n')
  }

  /**
   * Gets a formatted string of the agent's current mental state
   */
  public getMentalState(): string {
    const m = this.mentalState
    return `Confidence: ${(m.optimism * 10).toFixed(1)}/10, Frustration: ${(m.frustration * 10).toFixed(1)}/10`
  }

  /**
   * Gets a formatted string of the agent's psychological profile parameters
   */
  public getProfileSummary(): string {
    const p = this.profile
    return `
Risk tolerance: ${(p.riskTolerance * 10).toFixed(1)}/10
Trust in others: ${(p.trustInOthers * 10).toFixed(1)}/10
Wealth focus: ${(p.wealthFocus * 10).toFixed(1)}/10
Fairness focus: ${(p.fairnessFocus * 10).toFixed(1)}/10
Patience: ${(p.patience * 10).toFixed(1)}/10
`.trim()
  }

  /**
   * Finalizes a game round by:
   * 1. Moving the pending decision to permanent history
   * 2. Updating performance statistics
   * 3. Adjusting mental state based on outcome
   * 4. Saving the updated state to disk
   */
  async finalizeRound(
    game: string, 
    result: string, 
    profit: number, 
    session: number, 
    round: number,
    additionalData?: any 
  ) {
    // Retrieve the oldest pending decision (FIFO)
    const decision = this.pendingDecisions.shift()
    if (!decision) {
      console.warn(`[${this.name}] No pending decision for finalization`)
      return
    }

    // Create experience record
    const exp: Experience = {
      game,
      session,
      round,
      choice: decision.choice,
      reasoning: decision.reasoning,
      result,
      profit,
      timestamp: new Date().toISOString(),
      ...additionalData
    }

    // Update histories
    this.fullHistory.push(exp)
    this.recentHistory.push(exp)
    if (this.recentHistory.length > 10) this.recentHistory.shift()

    // Update statistics and mental state
    this.updatePerformanceStats(game, exp.choice, profit, result)
    this.updateMentalState(profit)

    // Persist to disk
    this.saveState()
  }

  /**
   * Clears all pending decisions (used when a round is cancelled or invalid)
   */
  clearPendingDecisions() { 
    this.pendingDecisions = []
  }

  /**
   * Updates performance statistics for a specific game and choice
   */
  private updatePerformanceStats(game: string, choice: number, profit: number, result: string) {
    if (!this.performanceStats[game]) this.performanceStats[game] = {}
    if (!this.performanceStats[game][choice]) {
      this.performanceStats[game][choice] = { timesChosen: 0, totalProfit: 0, wins: 0, losses: 0 }
    }
    
    const stat = this.performanceStats[game][choice]
    stat.timesChosen++
    stat.totalProfit += profit
    if (result === 'WIN') stat.wins++
    else if (result === 'LOSS') stat.losses++
  }

  /**
   * Updates the agent's emotional state based on the profit of the last round.
   * Negative profit increases frustration and resets optimism.
   * Positive profit decreases frustration and increases optimism.
   */
  private updateMentalState(profit: number) {
    if (profit < 0) {
      // Loss: increase frustration, decrease optimism, track losing streak
      this.mentalState.consecutiveLosses++
      this.mentalState.frustration = Math.min(1.0, this.mentalState.frustration + 0.2) // +20% frustration
      this.mentalState.optimism = Math.max(0.0, this.mentalState.optimism - 0.1)
    } else if (profit > 0) {
      // Win: reset losing streak, decrease frustration, increase optimism
      this.mentalState.consecutiveLosses = 0
      this.mentalState.frustration = Math.max(0.0, this.mentalState.frustration - 0.3) // Relief
      this.mentalState.optimism = Math.min(1.0, this.mentalState.optimism + 0.1)
    }
  }

  /**
   * Loads agent state from persistent storage (JSON file).
   * Handles missing files gracefully by starting with a fresh state.
   */
  private loadState() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        
        // Restore full history and create recent history cache
        this.fullHistory = data.history || []
        this.recentHistory = this.fullHistory.slice(-5)
        this.performanceStats = data.performanceStats || {}
        
        // Restore mental state if it exists
        if (data.mentalState) {
          this.mentalState = data.mentalState
        }
        
        console.log(`[${this.name}] 💾 Loaded state: ${this.fullHistory.length} rounds, ${Object.keys(this.performanceStats).length} game types`)
      } catch (e) {
        console.warn(`[${this.name}] ⚠️ Failed to load state: ${e}`)
      }
    } else {
      console.log(`[${this.name}] 🆕 Starting fresh (no saved state)`)
    }
  }

  /**
   * Saves the current agent state to persistent storage (JSON file).
   * Includes profile, mental state, complete history, and performance statistics.
   */
  private saveState() {
    const data = {
      name: this.name,
      profile: this.profile,
      mentalState: this.mentalState,
      history: this.fullHistory,
      performanceStats: this.performanceStats,
    }
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}