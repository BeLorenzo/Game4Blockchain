/* eslint-disable @typescript-eslint/no-explicit-any */
import { Account, TransactionSigner } from 'algosdk'
import * as fs from 'fs'
import * as path from 'path'
import { askLLM, LLMDecision } from './llm'

// --- CONTEXT INTERFACE ---
export interface RoundContext {
  gameRules: string // Game mechanics
  marketSituation: string // Pre-formatted string from the Game
}

// --- PSYCHOLOGICAL PROFILES ---
export interface AgentIdentity {
  selfImage: string
  timeHorizon: string
  archetype: string
}

export interface AgentBeliefs {
  trustInOthers: number
  viewOfWorld: string
}

export interface AgentValues {
  wealth: number
  fairness: number
  stability: number
  curiosity: number
}

export interface AgentRiskProfile {
  aversion: number
  lossSensitivity: number
}

export interface PsychologicalProfile {
  identity: AgentIdentity
  beliefs: AgentBeliefs
  values: AgentValues
  risk: AgentRiskProfile
  resilience: number
  adaptability: number
}

export interface AgentMentalState {
  groupTrust: number
  optimism: number
  frustration: number
  recentVolatility: number
  consecutiveLosses: number
  streakCounter: number
}

export interface Experience {
  game: string
  round: number
  choice: number
  result: string
  groupResult: string
  profit: number
  reasoning: string
  timestamp: string
  mentalSnapshot?: AgentMentalState
}

// --- PERFORMANCE STATS ---
interface ActionStat {
  timesChosen: number
  totalProfit: number
  avgProfit: number
  wins: number
  losses: number
  winRate: number
}

interface ActionStatWithChoice extends ActionStat {
  choice: number
}

interface GameStatsMap {
  [gameName: string]: {
    [choiceId: number]: ActionStat
  }
}

export class Agent {
  account: Account
  name: string
  model: string

  public profile: PsychologicalProfile
  public mentalState: AgentMentalState

  // Dual Memory Architecture
  private recentHistory: Experience[] = [] // Last 5 for prompt context
  private fullHistory: Experience[] = [] // Complete for stats/persistence

  // Performance Stats
  private performanceStats: GameStatsMap = {}

  private filePath: string
  private currentRoundMemory: { choice: number; reasoning: string } | null = null

  constructor(account: Account, name: string, profile: PsychologicalProfile, model: string) {
    this.account = account
    this.name = name
    this.profile = profile
    this.model = model

    this.mentalState = {
      groupTrust: profile.beliefs.trustInOthers,
      optimism: 0.5 + profile.resilience * 0.2 - profile.risk.aversion * 0.1,
      frustration: 0.0,
      recentVolatility: 0.0,
      consecutiveLosses: 0,
      streakCounter: 0,
    }

    const dataDir = path.join(process.cwd(), 'data', 'agents')
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    this.filePath = path.join(dataDir, `${this.name.replace(/\s+/g, '_')}.json`)

    this.loadState()
  }

  // --- DYNAMIC TEMPERATURE ---
  get dynamicTemperature(): number {
    if (this.profile.risk.aversion > 0.7) return 0.2 // Very cold/rational
    if (this.profile.risk.aversion < 0.3) return 0.9 // Very hot/creative
    return 0.7 // Default
  }

  // --- PLAY ROUND---
  async playRound(gameName: string, context: RoundContext): Promise<LLMDecision> {
    const p = this.profile
    const m = this.mentalState

    // 1. Get top 3 historical actions for this game
    const topActions = this.getTopActions(gameName, 3)

    // 2. Format recent history (last 5 rounds)
    const recentHistoryText = this.formatRecentHistory(gameName)

    // 3. GENERIC PROMPT - No game-specific logic
    const prompt = `
You are ${this.name}, archetype: ${p.identity.archetype}.
Worldview: "${p.beliefs.viewOfWorld}"

GAME RULES:
${context.gameRules}

CURRENT MARKET SITUATION:
${context.marketSituation}

YOUR HISTORICAL PERFORMANCE IN THIS GAME:
${
  topActions.length > 0
    ? topActions
        .map(
          (a) =>
            `• Choice ${a.choice}: ${(a.winRate * 100).toFixed(0)}% wins, avg profit ${a.avgProfit.toFixed(1)} ALGO (tried ${a.timesChosen}x)`,
        )
        .join('\n')
    : '• No history yet. First time playing this game.'
}

YOUR RECENT EXPERIENCE (last 5 rounds):
${recentHistoryText}

YOUR CURRENT MENTAL STATE:
• Confidence: ${(m.optimism * 10).toFixed(1)}/10
• Frustration: ${(m.frustration * 10).toFixed(1)}/10
• Group Trust: ${(m.groupTrust * 10).toFixed(1)}/10

ARCHETYPE GUIDANCE:
${this.getArchetypeGuidance()}

Analyze the situation and make your choice based on your personality and experience.

Respond JSON: {"choice": <number>, "reasoning": "<brief explanation>"}
    `.trim()

    const decision = await askLLM(prompt, this.model, {
      temperature: this.dynamicTemperature,
    })

    this.currentRoundMemory = { ...decision }
    return decision
  }

  // --- FINALIZE ROUND ---
  async finalizeRound(game: string, result: string, profit: number, groupResult: string, round: number) {
    if (!this.currentRoundMemory) return

    const exp: Experience = {
      game,
      round,
      choice: this.currentRoundMemory.choice,
      reasoning: this.currentRoundMemory.reasoning,
      result,
      groupResult,
      profit,
      timestamp: new Date().toISOString(),
      mentalSnapshot: { ...this.mentalState },
    }

    // 1. Update both histories
    this.fullHistory.push(exp)
    this.recentHistory.push(exp)
    if (this.recentHistory.length > 5) this.recentHistory.shift() // Keep last 5

    // 2. Update performance stats
    this.updatePerformanceStats(game, exp.choice, profit, result)

    // 3. Update mental state
    this.updateMentalState(profit, result, groupResult, exp.choice)

    this.saveState()
    this.currentRoundMemory = null
  }

  // --- UPDATE PERFORMANCE STATS ---
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
    stat.avgProfit = stat.avgProfit * 0.7 + profit * 0.3 // EMA

    if (result === 'WIN') stat.wins++
    else if (result === 'LOSS') stat.losses++

    stat.winRate = stat.wins / stat.timesChosen
  }

  // --- GET TOP ACTIONS ---
  private getTopActions(game: string, limit: number): ActionStatWithChoice[] {
    const stats = this.performanceStats[game]
    if (!stats) return []

    return Object.keys(stats)
      .map(Number)
      .map((choice) => ({ choice, ...stats[choice] }))
      .sort((a, b) => b.avgProfit - a.avgProfit)
      .slice(0, limit)
  }

  // --- FORMAT RECENT HISTORY ---
  private formatRecentHistory(game: string): string {
    const gameHistory = this.recentHistory.filter((h) => h.game === game)
    if (gameHistory.length === 0) return '• No recent history for this game.'

    return gameHistory
      .map((h) => `• Round ${h.round}: Choice ${h.choice} → ${h.result} (${h.profit.toFixed(1)} ALGO)`)
      .join('\n')
  }

  // --- UPDATE MENTAL STATE ---
  private updateMentalState(profit: number, result: string, groupResult: string, choice: number) {
    const p = this.profile
    const m = this.mentalState
    const learningRate = 0.15 * p.adaptability
    const recoveryRate = 0.2 * p.resilience

    // Natural dissipation
    m.frustration *= 0.9

    if (profit < 0) {
      // LOSS
      m.consecutiveLosses++

      // Check stubbornness
      let isStubbornness = false
      if (this.fullHistory.length >= 2) {
        const prev = this.fullHistory[this.fullHistory.length - 2]
        if (prev.profit < 0 && prev.choice === choice) {
          isStubbornness = true
        }
      }

      let pain = Math.min(0.25, Math.abs(profit) * p.risk.lossSensitivity * 0.05)

      if (isStubbornness) {
        pain *= 2.0
        m.optimism -= 0.1
      }

      if (p.resilience > 0.7) pain *= 0.6

      m.frustration = Math.min(1.0, m.frustration + pain)
      m.optimism = Math.max(0.05, m.optimism - 0.05)
    } else if (profit > 0) {
      // WIN
      m.consecutiveLosses = 0
      const recoveryBoost = recoveryRate * (1 + p.resilience * 0.3)
      m.frustration = Math.max(0.0, m.frustration - recoveryBoost)
      m.optimism = Math.min(0.95, m.optimism + 0.1)
    } else {
      // BREAKEVEN
      m.consecutiveLosses = 0

      if (m.optimism > 0.6) {
        m.frustration += 0.05
        m.optimism -= 0.05
      } else if (m.optimism < 0.4) {
        m.frustration = Math.max(0, m.frustration - 0.05)
        m.optimism += 0.02
      }

      if (p.values.wealth > 0.7) m.frustration += 0.03
    }

    // Group trust
    if (groupResult === 'WIN') {
      m.groupTrust = Math.min(1.0, m.groupTrust + learningRate * 1.2)
    } else {
      m.groupTrust = Math.max(0.0, m.groupTrust - learningRate)
    }

    // Anti-spiral after 3+ consecutive losses
    if (m.consecutiveLosses >= 3 && p.adaptability > 0.5) {
      m.frustration *= 0.6
      m.optimism = 0.5
    }
  }

  // --- ARCHETYPE GUIDANCE ---
  private getArchetypeGuidance(): string {
    const p = this.profile

    if (p.identity.archetype.includes('Computer') || p.identity.archetype.includes('Scientist')) {
      return 'Analyze data objectively. Optimize for expected value. Ignore emotions.'
    }

    if (p.identity.archetype.includes('Prepper') || p.identity.archetype.includes('Saver')) {
      return 'Prioritize safety. Avoid risks. Protect your capital at all costs.'
    }

    if (p.identity.archetype.includes('Roller') || p.identity.archetype.includes('Yolo')) {
      return 'Take calculated risks. Go for the big win. Fortune favors the bold.'
    }

    if (p.identity.archetype.includes('Punisher') || p.identity.archetype.includes('Grudge')) {
      return 'Remember who betrayed you. Fairness matters. Punish defectors.'
    }

    if (p.identity.archetype.includes('Idealist') || p.identity.archetype.includes('Hope')) {
      return 'Trust the group. Cooperation builds value. Keep faith even after losses.'
    }

    if (p.identity.archetype.includes('Survivor') || p.identity.archetype.includes('Flex')) {
      return 'Adapt to the situation. If the group cooperates, cooperate. If not, defect.'
    }

    return 'Play according to your personality and values.'
  }

  // --- PERSISTENCE ---
  private loadState() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        this.fullHistory = data.history || []
        this.recentHistory = data.history ? data.history.slice(-5) : []
        this.performanceStats = data.performanceStats || {}
        if (data.mentalState) this.mentalState = { ...this.mentalState, ...data.mentalState }
      } catch {
        this.fullHistory = []
        this.recentHistory = []
        this.performanceStats = {}
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

  public getLastMove(gameName: string): Experience | undefined {
    return this.fullHistory.filter((h) => h.game === gameName).pop()
  }

  get signer(): TransactionSigner {
    return (txnGroup, indexes) => Promise.resolve(indexes.map((i) => txnGroup[i].signTxn(this.account.sk)))
  }
}
