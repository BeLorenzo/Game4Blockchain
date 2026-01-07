/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Account, TransactionSigner } from 'algosdk'
import * as fs from 'fs'
import * as path from 'path'
import { askLLM, LLMDecision } from './llm'

// --- PSYCHOLOGICAL PROFILE ---
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

// MODIFICA 1: Struttura adattata per Sessione + Round
export interface Experience {
  game: string
  session: number // ID della Partita (es. Game 1, Game 2...)
  round: number   // Round interno (es. Round 1, Round 2...). Per giochi one-shot è sempre 1.
  choice: number
  result: string
  profit: number
  reasoning: string
  timestamp: string
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

// AGENT: CERVELLO PRIMORDIALE
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
  
  private currentDecisionMemory: { choice: number; reasoning: string } | null = null

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
    return 0.3 + this.profile.curiosity * 0.6
  }

  // CORE: Riceve prompt completo dal game adapter
  async playRound(gameName: string, promptFromGame: string): Promise<LLMDecision> {
    const decision = await askLLM(promptFromGame, this.model, {
      temperature: this.dynamicTemperature,
    })

    console.log(`\n[${this.name}] Choice: ${decision.choice}`)
    // console.log(`[${this.name}] Reasoning: "${decision.reasoning}"`)

    // Salviamo l'ultima decisione presa. 
    // In giochi a fasi (Pirate), l'ultima sovrascrive la precedente (es. Reveal sovrascrive Vote).
    // Questo va bene perché vogliamo tracciare l'esito finale del round.
    this.currentDecisionMemory = { ...decision }
    
    return decision
  }

  // PUBLIC API: Game adapters query agent state
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

    if (best.timesChosen >= 2) {
      lessons += `Choice ${best.choice}: Best performer (${(best.winRate * 100).toFixed(0)}% wins, ${best.avgProfit.toFixed(1)} ALGO avg)\n`
    }

    if (worst.timesChosen >= 2 && worst.avgProfit < -1 && sorted.length > 1) {
      lessons += `Choice ${worst.choice}: Worst performer (${worst.losses} losses, ${worst.avgProfit.toFixed(1)} ALGO avg)\n`
    }

    if (this.mentalState.consecutiveLosses >= 3) {
      lessons += `CRITICAL: ${this.mentalState.consecutiveLosses} consecutive losses! Something's wrong.\n`
    }

    return lessons
  }

  // MODIFICA 2: Visualizzazione pulita "G1-R1"
  public getRecentHistory(game: string, limit: number = 3): string {
    const gameHistory = this.recentHistory.filter((h) => h.game === game).slice(-limit)
    if (gameHistory.length === 0) return '• No recent moves'

    return gameHistory
      .map((h) => {
        const profitStr = h.profit >= 0 ? `+${h.profit.toFixed(1)}` : h.profit.toFixed(1)
        // Esempio: "Game 1-R2: Choice 1 → -10.0 ALGO"
        return `Game ${h.session}-R${h.round}: Choice ${h.choice} → ${profitStr} ALGO`
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

  // MODIFICA 3: Accetta session (Partita globale) e round (Turno interno)
  async finalizeRound(game: string, result: string, profit: number, session: number, round: number) {
    if (!this.currentDecisionMemory) return

    const exp: Experience = {
      game,
      session, // ID Partita (es. 1, 2, 3)
      round,   // ID Round (es. 1, 2... N)
      choice: this.currentDecisionMemory.choice,
      reasoning: this.currentDecisionMemory.reasoning,
      result,
      profit,
      timestamp: new Date().toISOString(),
    }

    this.fullHistory.push(exp)
    this.recentHistory.push(exp)
    if (this.recentHistory.length > 5) this.recentHistory.shift()

    this.updatePerformanceStats(game, exp.choice, profit, result)
    this.updateMentalState(profit, result, exp.choice)

    this.saveState()
    this.currentDecisionMemory = null
  }

  // --- INTERNAL ---
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
    stat.avgProfit = stat.avgProfit * 0.7 + profit * 0.3

    if (result === 'WIN') stat.wins++
    else if (result === 'LOSS') stat.losses++

    stat.winRate = stat.wins / stat.timesChosen
  }

  private updateMentalState(profit: number, result: string, choice: number) {
    const p = this.profile
    const m = this.mentalState

    m.frustration *= 0.9

    if (profit < 0) {
      m.consecutiveLosses++
      m.streakCounter = 0

      let isStubbornness = false
      if (this.fullHistory.length >= 2) {
        const prev = this.fullHistory[this.fullHistory.length - 2]
        if (prev.profit < 0 && prev.choice === choice) isStubbornness = true
      }

      let pain = Math.min(0.25, Math.abs(profit) * 0.01)
      if (isStubbornness) pain *= 2.0
      if (p.resilience > 0.7) pain *= 0.6

      m.frustration = Math.min(1.0, m.frustration + pain)
      m.optimism = Math.max(0.05, m.optimism - 0.05)
    } else if (profit > 0) {
      m.consecutiveLosses = 0
      m.streakCounter++

      const recovery = 0.2 * (1 + p.resilience * 0.3)
      m.frustration = Math.max(0.0, m.frustration - recovery)
      m.optimism = Math.min(0.95, m.optimism + 0.1)
    } else {
      m.consecutiveLosses = 0
      m.streakCounter = 0
    }

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
      } catch {}
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

  get signer(): TransactionSigner {
    return (txnGroup, indexes) => Promise.resolve(indexes.map((i) => txnGroup[i].signTxn(this.account.sk)))
  }
}
