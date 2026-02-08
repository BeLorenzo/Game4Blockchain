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

interface ActionStat {
  timesChosen: number
  totalProfit: number
  wins: number
  losses: number
}

interface GameStatsMap {
  [gameName: string]: {
    [choiceId: number]: ActionStat
  }
}

interface PendingDecision {
  choice: number
  reasoning: string
  timestamp: number
}

type LogCallback = (agentName: string, type: 'thought' | 'action', message: string) => void;

/**
 * Represents an AI Agent capable of interacting with Algorand Smart Contracts.
 * * Features:
 * - **Persistence**: Saves/Loads history and learning data to JSON.
 * - **Psychology**: Simulates emotions (frustration, optimism) that affect decision temperature.
 * - **Strategy**: Implements "Exploit" (auto-pilot on winning moves) and "Emergency" (override personality on losing streaks) modes.
 */
export class Agent {
  account: Account
  name: string
  model: string
  profile: PsychologicalProfile
  mentalState: AgentMentalState

  private recentHistory: Experience[] = []
  private fullHistory: Experience[] = []
  private performanceStats: GameStatsMap = {}
  private filePath: string
  
  // Temporary storage for a decision before the transaction confirms
  private pendingDecisions: PendingDecision[] = []

  private onLog: LogCallback = () => {}

  constructor(account: Account, name: string, profile: PsychologicalProfile, model: string) {
    this.account = account
    this.name = name
    this.profile = profile
    this.model = model

    this.mentalState = {
      optimism: 0.5,
      frustration: 0.0,
      consecutiveLosses: 0,
      //streakCounter: 0,
    }

    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'simulation', 'data', 'agents')
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    this.filePath = path.join(dataDir, `${this.name.replace(/\s+/g, '_')}.json`)

    this.loadState() 
  }

  public setLogger(callback: LogCallback) {
    this.onLog = callback;
  }

  /**
   * Calculates the sampling temperature for the LLM.
   * High frustration/loss leads to lower temperature (more deterministic/conservative behavior).
   * High curiosity leads to higher temperature (more exploration).
   */
  get dynamicTemperature(): number {
    // Increase randomness if frustrated (desperation) or curious
    let temp = 0.4 + (this.profile.curiosity * 0.4);
    if (this.mentalState.consecutiveLosses > 3) temp += 0.3;
    return Math.min(1.0, Math.max(0.1, temp));
  }

  /**
   * Returns a TransactionSigner compatible with AlgoKit/AlgoSDK.
   */
  get signer(): TransactionSigner {
    return (txnGroup, indexes) => Promise.resolve(indexes.map((i) => txnGroup[i].signTxn(this.account.sk)))
  }

  /**
   * Core decision-making loop.
   * * Workflow:
   * 1. **Exploit Check**: If a specific move has a high win rate & ROI, auto-play it (skip LLM).
   * 2. **Emergency Check**: If on a losing streak, override personality with pure data analysis.
   * 3. **Standard Play**: Consult LLM with full personality context.
   */
  async playRound<T extends z.ZodType<any>>(
    gameName: string, 
    gamePrompt: string,
    schema: T = BaseDecisionSchema as any
  ): Promise<z.infer<T>> {    

    this.onLog(this.name, 'thought', `Analyzing ${gameName}... Temperature: ${this.dynamicTemperature.toFixed(2)}`);
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 1. Build Standard Prompt
    const fullPrompt = this.buildFullPrompt(gameName, gamePrompt)

    // 2. Query LLM
    const decision = await askLLM(fullPrompt, this.model, schema, {
      temperature: this.dynamicTemperature,
    })

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
   * Constructs the full context for the LLM, including:
   * - Personality Profile
   * - Historical Performance (Lessons Learned)
   * - Recent Moves
   * - Current Mental State
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
   * Generates a text summary of performance stats for the specific game.
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
   * Retrieves the last N moves from history for the specific game.
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

  public getMentalState(): string {
    const m = this.mentalState
    return `Confidence: ${(m.optimism * 10).toFixed(1)}/10, Frustration: ${(m.frustration * 10).toFixed(1)}/10`
  }

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
   * Finalizes the round by moving the pending decision to permanent history,
   * updating stats, and saving state to disk.
   */
  async finalizeRound(
    game: string, 
    result: string, 
    profit: number, 
    session: number, 
    round: number,
    additionalData?: any 
  ) {
    const decision = this.pendingDecisions.shift()
    if (!decision) {
      console.warn(`[${this.name}] No pending decision for finalization`)
      return
    }

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

    this.fullHistory.push(exp)
    this.recentHistory.push(exp)
    if (this.recentHistory.length > 10) this.recentHistory.shift()

    this.updatePerformanceStats(game, exp.choice, profit, result)
    this.updateMentalState(profit)

    this.saveState()
  }

  clearPendingDecisions() { 
    this.pendingDecisions = []
  }

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
   */
  private updateMentalState(profit: number) {
    if (profit < 0) {
      this.mentalState.consecutiveLosses++
      this.mentalState.frustration = Math.min(1.0, this.mentalState.frustration + 0.2) // +20% frustration
      this.mentalState.optimism = Math.max(0.0, this.mentalState.optimism - 0.1)
    } else if (profit > 0) {
      this.mentalState.consecutiveLosses = 0
      this.mentalState.frustration = Math.max(0.0, this.mentalState.frustration - 0.3) // Relief
      this.mentalState.optimism = Math.min(1.0, this.mentalState.optimism + 0.1)
    }
  }

  private loadState() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        
        this.fullHistory = data.history || []
        this.recentHistory = this.fullHistory.slice(-5)
        this.performanceStats = data.performanceStats || {}
        
        if (data.mentalState) {
          this.mentalState = data.mentalState
        }
        
        console.log(`[${this.name}] 💾 Loaded state: ${this.fullHistory.length} games, ${Object.keys(this.performanceStats).length} game types`)
      } catch (e) {
        console.warn(`[${this.name}] ⚠️ Failed to load state: ${e}`)
      }
    } else {
      console.log(`[${this.name}] 🆕 Starting fresh (no saved state)`)
    }
  }

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
