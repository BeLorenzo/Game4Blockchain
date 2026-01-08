/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Account, TransactionSigner } from 'algosdk'
import * as fs from 'fs'
import * as path from 'path'
import { askLLM, BaseDecisionSchema } from './llm'
import { z } from "zod";

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

export interface AgentMentalState {
  optimism: number
  frustration: number
  consecutiveLosses: number
  streakCounter: number
}

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
  avgProfit: number
  wins: number
  losses: number
  winRate: number
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
  
  private pendingDecisions: PendingDecision[] = []

  constructor(account: Account, name: string, profile: PsychologicalProfile, model: string) {
    this.account = account
    this.name = name
    this.profile = profile
    this.model = model

    this.mentalState = {
      optimism: 0.5 + profile.resilience * 0.2,
      frustration: 0.0,
      consecutiveLosses: 0,
      streakCounter: 0,
    }

    const dataDir = path.join(process.cwd(), 'simulation', 'data', 'agents')
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    this.filePath = path.join(dataDir, `${this.name.replace(/\s+/g, '_')}.json`)

    this.loadState()
  }

  get dynamicTemperature(): number {
    // Lower temperature when struggling (more deterministic)
    const baseTemp = 0.3 + this.profile.curiosity * 0.6
    if (this.mentalState.consecutiveLosses >= 5) {
      return Math.max(0.1, baseTemp - 0.3) // More focused when desperate
    }
    return baseTemp
  }

  get signer(): TransactionSigner {
    return (txnGroup, indexes) => Promise.resolve(indexes.map((i) => txnGroup[i].signTxn(this.account.sk)))
  }

async playRound<T extends z.ZodType<any>>(
  gameName: string, 
  promptFromGame: string,
  schema: T = BaseDecisionSchema as any // Fallback allo schema base
): Promise<z.infer<T>> {    

  const exploitCheck = this.shouldExploit(gameName)

    if (exploitCheck.exploit && Math.random() < 0.3) {
      console.log(`[${this.name}] Auto-exploiting proven winner: ${exploitCheck.choice}`)

      const baseDecision = {
        choice: exploitCheck.choice!,
        reasoning: `Auto-exploiting proven winner (${(this.performanceStats[gameName][exploitCheck.choice!].winRate * 100).toFixed(0)}% win rate, +${this.performanceStats[gameName][exploitCheck.choice!].avgProfit.toFixed(1)} ALGO avg)`
      }
    try {
      const validatedDecision = schema.parse(baseDecision);

      this.pendingDecisions.push({
        ...validatedDecision,
        timestamp: Date.now()
      })
      return validatedDecision
    } catch (e) {
      console.warn(`[${this.name}] Exploit incompatible with schema, falling back to LLM.`);
    }
  }

    // After 5 consecutive losses, override personality with pure logic
 if (this.mentalState.consecutiveLosses >= 5) {
    console.log(`[${this.name}] Emergency override mode activated (${this.mentalState.consecutiveLosses} losses)`)
    promptFromGame = this.buildEmergencyPrompt(gameName, promptFromGame)
    this.profile.resilience = Math.min(1.0, this.profile.resilience + 0.2)
    this.profile.adaptability = Math.min(1.0, this.profile.adaptability + 0.2)
  }

   const decision = await askLLM(promptFromGame, this.model, schema, {
    temperature: this.dynamicTemperature,
  })

  console.log(`\n[${this.name}] Choice: ${decision.choice}`)

    this.pendingDecisions.push({
    ...decision,
    timestamp: Date.now()
  })
    
    return decision
  }


  private buildEmergencyPrompt(game: string, originalPrompt: string): string {
    const stats = this.performanceStats[game]
    let prescription = ''

    if (stats && Object.keys(stats).length > 0) {
      const sorted = Object.entries(stats)
        .map(([choice, data]) => ({ choice: Number(choice), ...data }))
        .sort((a, b) => b.avgProfit - a.avgProfit)

      const best = sorted[0]
      if (best.avgProfit > 0) {
        prescription = `Your data shows Choice ${best.choice} is best (+${best.avgProfit.toFixed(1)} ALGO avg). Try that or nearby values.`
      } else {
        prescription = `All your choices failed. Try the OPPOSITE of what you've been doing.`
      }
    } else {
      prescription = `No data yet. Use pure game theory.`
    }

    return `

EMERGENCY OVERRIDE MODE ACTIVATED               

SITUATION: You have ${this.mentalState.consecutiveLosses} CONSECUTIVE LOSSES.

Your personality: ${this.profile.personalityDescription}

HOWEVER: For THIS decision, TEMPORARILY IGNORE your personality.
Use PURE DATA-DRIVEN LOGIC instead.

Your Performance Data:
${JSON.stringify(this.performanceStats[game], null, 2)}

DATA-DRIVEN PRESCRIPTION:
${prescription}

EMERGENCY PROTOCOL:
1. Identify your highest avgProfit choice (if positive)
2. If all negative: Try something RADICALLY different
3. Ignore fairness, revenge, emotion - focus on WINNING
4. After this round, you can return to your personality

═══════════════════════════════════════════════════════════

${originalPrompt}

═══════════════════════════════════════════════════════════

REMINDER: Your current strategy is FAILING. Use the data above.
Choose the mathematically optimal play, not the one that "feels right".
`
  }

  private shouldExploit(game: string): { exploit: boolean, choice?: number } {
    const stats = this.performanceStats[game]
    if (!stats) return { exploit: false }

    const candidates = Object.entries(stats)
      .map(([choice, data]) => ({ choice: Number(choice), ...data }))
      .filter(s => s.timesChosen >= 2) // Minimum sample size
      .filter(s => s.winRate >= 0.5)    // At least 50% win rate
      .filter(s => s.avgProfit > 15)    // Significant positive return

    if (candidates.length === 0) return { exploit: false }

    // Pick the best by avgProfit
    const best = candidates.sort((a, b) => b.avgProfit - a.avgProfit)[0]
    
    return { exploit: true, choice: best.choice }
  }

  public getLessonsLearned(game: string): string {
    const stats = this.performanceStats[game]
    if (!stats || Object.keys(stats).length === 0) {
      return '• First time playing - no experience yet'
    }

    const sorted = Object.entries(stats)
      .map(([choice, s]) => ({ choice: Number(choice), ...s }))
      .sort((a, b) => b.avgProfit - a.avgProfit)

    const best = sorted[0]
    const worst = sorted[sorted.length - 1]

    let lessons = 'WHAT YOU\'VE LEARNED:\n'

    if (best.winRate >= 0.5 && best.avgProfit > 15 && best.timesChosen >= 2) {
      lessons += `✅ WINNING STRATEGY FOUND: Choice ${best.choice}\n`
      lessons += `   - Win rate: ${(best.winRate * 100).toFixed(0)}% (${best.wins}/${best.timesChosen})\n`
      lessons += `   - Avg profit: +${best.avgProfit.toFixed(1)} ALGO\n`
      lessons += `   STRONG RECOMMENDATION: Play ${best.choice} again OR ${best.choice}±5\n\n`
    }

    // AVOIDANCE WARNING 
    if (worst.timesChosen >= 3 && worst.avgProfit < -5) {
      lessons += `PROVEN FAILURE: Choice ${worst.choice}\n`
      lessons += ` - ${worst.losses} losses, ${worst.avgProfit.toFixed(1)} ALGO avg\n`
      lessons += ` BLACKLIST: Never use this choice again\n\n`
    }

    // VARIANCE DETECTION 
    if (sorted.length >= 4) {
      const choiceRange = sorted[0].choice - sorted[sorted.length - 1].choice
      if (choiceRange > 50) {
        lessons += ` HIGH VARIANCE: Your choices range from ${sorted[sorted.length - 1].choice} to ${sorted[0].choice}\n`
        lessons += `   This suggests random behavior. Narrow your focus.\n\n`
      }
    }

    // LOSS STREAK INTERVENTION 
    if (this.mentalState.consecutiveLosses >= 3) {
      lessons += `CRITICAL: ${this.mentalState.consecutiveLosses} consecutive losses!\n`
      lessons += `   Your current strategy is FAILING.\n`
      
      if (best.avgProfit > 0) {
        lessons += `   Return to Choice ${best.choice} (your historical best)\n`
      } else {
        lessons += `   Try OPPOSITE approach: Change strategy radically\n`
      }
      lessons += '\n'
    }

    return lessons
  }

  public getRecentHistory(game: string, limit: number = 10): string {
    const gameHistory = this.recentHistory.filter((h) => h.game === game).slice(-limit)
    if (gameHistory.length === 0) return '• No recent moves'

    return gameHistory
      .map((h) => {
        const profitStr = h.profit >= 0 ? `+${h.profit.toFixed(1)}` : h.profit.toFixed(1)
        let extra = ''
        if (h.role) extra += ` [${h.role}]`
        if (h.roundEliminated) extra += ` (eliminated R${h.roundEliminated})`
        return `Game ${h.session}-R${h.round}: Choice ${h.choice} → ${profitStr} ALGO${extra}`
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

  async finalizeRound(
    game: string, 
    result: string, 
    profit: number, 
    session: number, 
    round: number,
    additionalData?: {
      role?: string
      proposalAccepted?: boolean
      roundEliminated?: number
    }
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
    if (this.recentHistory.length > 5) this.recentHistory.shift()

    this.updatePerformanceStats(game, exp.choice, profit, result)
    this.updateMentalState(profit, result, exp.choice)

    this.saveState()
  }

  clearPendingDecisions() {
    this.pendingDecisions = []
  }

  private updatePerformanceStats(game: string, choice: number, profit: number, result: string) {
    if (!this.performanceStats[game]) this.performanceStats[game] = {}
    if (!this.performanceStats[game][choice]) {
      this.performanceStats[game][choice] = {
        timesChosen: 0,
        totalProfit: 0,
        avgProfit: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
      }
    }

    const stat = this.performanceStats[game][choice]
    stat.timesChosen++
    stat.totalProfit += profit
    
    // Exponential moving average for recency bias
    stat.avgProfit = stat.avgProfit * 0.7 + profit * 0.3

    if (result === 'WIN') stat.wins++
    else if (result === 'LOSS') stat.losses++

    stat.winRate = stat.wins / stat.timesChosen
  }

  private updateMentalState(profit: number, result: string, choice: number) {
    const p = this.profile
    const m = this.mentalState

    // Frustration decay
    m.frustration *= 0.9

    if (profit < 0) {
      m.consecutiveLosses++
      m.streakCounter = 0

      // Detect stubbornness (repeating losing choices)
      let isStubbornness = false
      if (this.fullHistory.length >= 2) {
        const prev = this.fullHistory[this.fullHistory.length - 2]
        if (prev.profit < 0 && prev.choice === choice) isStubbornness = true
      }

      let pain = Math.min(0.25, Math.abs(profit) * 0.01)
      if (isStubbornness) pain *= 2.0 // Double frustration for repeated mistakes
      if (p.resilience > 0.7) pain *= 0.6 // Resilient agents handle losses better

      m.frustration = Math.min(1.0, m.frustration + pain)
      m.optimism = Math.max(0.05, m.optimism - 0.05)
      
    } else if (profit > 0) {
      m.consecutiveLosses = 0
      m.streakCounter++

      const recovery = 0.2 * (1 + p.resilience * 0.3)
      m.frustration = Math.max(0.0, m.frustration - recovery)
      m.optimism = Math.min(0.95, m.optimism + 0.1)
      
    } else {
      // Draw/break-even
      m.consecutiveLosses = 0
      m.streakCounter = 0
    }

    // Adaptive agents recover faster from losses
    if (m.consecutiveLosses >= 3 && p.adaptability > 0.5) {
      m.frustration *= 0.6
      m.optimism = 0.5
    }
  }

  private loadState() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        this.fullHistory = data.history || []
        this.recentHistory = data.history ? data.history.slice(-5) : []
        this.performanceStats = data.performanceStats || {}
        if (data.mentalState) this.mentalState = { ...this.mentalState, ...data.mentalState }
      } catch (e) {
        console.warn(`[${this.name}] Failed to load state: ${e}`)
      }
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
