/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-control-regex */
import * as fs from 'fs'
import * as path from 'path'

interface HistoryItem {
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

interface AgentData {
  name: string
  profile: {
    personalityDescription: string
    riskTolerance: number
    trustInOthers: number
  }
  mentalState: {
    optimism: number
    frustration: number
  }
  history: HistoryItem[]
}

const R = '\x1b[0m'
const G = '\x1b[32m'
const E = '\x1b[31m'
const Y = '\x1b[33m'
const B = '\x1b[1m'
const C = '\x1b[36m'
const M = '\x1b[35m'
const DIM = '\x1b[2m'

const STAG_ICONS: Record<number, string> = { 1: '🦌', 0: '🐇' }
const WEEKLY_ICONS: Record<number, string> = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' }

async function main() {
  let files = process.argv.slice(2)
  if (files.length === 0) {
    const defaultDir = path.join(process.cwd(), 'simulation', 'data', 'agents')
    if (fs.existsSync(defaultDir)) {
      files = fs
        .readdirSync(defaultDir)
        .filter((f: string) => f.endsWith('.json'))
        .map((f: any) => path.join(defaultDir, f))
    }
  }

  if (files.length === 0) {
    console.log(Y + '⚠️  No agent files found.' + R)
    return
  }

  const agents: AgentData[] = []
  files.forEach((f: any) => {
    try {
      agents.push(JSON.parse(fs.readFileSync(f, 'utf-8')))
    } catch (e) {
      console.error(`Failed to load ${f}`)
    }
  })

  if (agents.length === 0) {
    console.log(Y + '⚠️  No valid agent data found.' + R)
    return
  }

  console.log(`\n${B}${C}╔═══════════════════════════════════════════════════════════╗${R}`)
  console.log(`${B}${C}║              GAME STATISTICS REPORT                       ║${R}`)
  console.log(`${B}${C}╚═══════════════════════════════════════════════════════════╝${R}\n`)

  const allGames = new Set<string>()
  agents.forEach((a) => a.history.forEach((h) => allGames.add(h.game)))

  console.log(`${DIM}Games detected: ${Array.from(allGames).join(', ')}${R}`)
  console.log(`${DIM}Total agents: ${agents.length}${R}\n`)

  for (const game of allGames) {
    if (game === 'PirateGame') {
      printMultiRoundGameSection(agents, game)
    } else {
      printStandardGameSection(agents, game)
    }
  }
}

function printStandardGameSection(agents: AgentData[], gameName: string) {
  const gameAgents = agents.map(a => ({
    ...a,
    history: a.history.filter(h => h.game === gameName)
  })).filter(a => a.history.length > 0)

  if (gameAgents.length === 0) return

  console.log(`\n${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`)
  console.log(`${B}${C}🎮 ${gameName.toUpperCase()}${R}`)
  console.log(`${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n`)

  printStandardTimeline(gameAgents, gameName)
  printStandardStats(gameAgents, gameName)
}

function printStandardTimeline(agents: AgentData[], gameName: string) {
  console.log(`${B}📜 Game Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  const maxSessions = Math.max(...agents.map(a => {
    const sessions = new Set(a.history.map(h => h.session))
    return sessions.size
  }))
  
  if (maxSessions === 0) return

  let header = 'Agent'.padEnd(16) + '| '
  for (let i = 1; i <= maxSessions; i++) header += `G${i}`.padEnd(5)
  console.log(DIM + header + R)
  console.log(DIM + '─'.repeat(header.length) + R)

  for (const agent of agents) {
    let row = agent.name.padEnd(16) + '| '
    
    for (let session = 1; session <= maxSessions; session++) {
      const sessionMoves = agent.history.filter(h => h.session === session)
      
      if (sessionMoves.length > 0) {
        const move = sessionMoves[0]
        let symbol = String(move.choice)

        if (gameName === 'StagHunt') symbol = STAG_ICONS[move.choice] || symbol
        if (gameName === 'WeeklyGame') symbol = WEEKLY_ICONS[move.choice] || symbol

        let coloredSymbol = symbol
        if (move.result === 'WIN') coloredSymbol = G + symbol + R
        else if (move.result === 'LOSS') coloredSymbol = E + symbol + R
        else coloredSymbol = Y + symbol + R

        row += coloredSymbol.padEnd(14)
      } else {
        row += DIM + '-'.padEnd(5) + R
      }
    }
    console.log(row)
  }
  console.log('')
}

function printStandardStats(agents: AgentData[], gameName: string) {
  console.log(`${B}📊 Statistics${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  interface Stats {
    name: string
    games: number
    wins: number
    losses: number
    totalProfit: number
    avgProfit: number
  }

  const stats: Stats[] = agents.map(a => {
    const sessions = new Set(a.history.map(h => h.session))
    const games = sessions.size
    const wins = a.history.filter(h => h.result === 'WIN').length
    const losses = a.history.filter(h => h.result === 'LOSS').length
    const totalProfit = a.history.reduce((sum, h) => sum + h.profit, 0)

    return {
      name: a.name,
      games,
      wins,
      losses,
      totalProfit,
      avgProfit: games > 0 ? totalProfit / games : 0
    }
  }).sort((a, b) => b.totalProfit - a.totalProfit)

  console.log('')
  console.log(`${DIM}Agent           Games   Wins  Losses   Total Profit   Avg/Game${R}`)
  console.log(DIM + '─'.repeat(70) + R)

  for (const s of stats) {
    const nameStr = s.name.padEnd(15)
    const gamesStr = s.games.toString().padStart(5)
    const winsStr = s.wins.toString().padStart(6)
    const lossStr = s.losses.toString().padStart(7)
    
    const profitColor = s.totalProfit > 0 ? G : s.totalProfit < 0 ? E : Y
    const profitStr = `${profitColor}${s.totalProfit.toFixed(1)}${R}`.padEnd(20)
    const avgStr = `${s.avgProfit.toFixed(1)}`

    console.log(`${nameStr} ${gamesStr} ${winsStr} ${lossStr}   ${profitStr} ${avgStr}`)
  }
  console.log('')
}

function printMultiRoundGameSection(agents: AgentData[], gameName: string) {
  const Agents = agents.map(a => ({
    ...a,
    history: a.history.filter(h => h.game === gameName)
  })).filter(a => a.history.length > 0)

  if (Agents.length === 0) return

  console.log(`\n${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`)
  console.log(`${B}${C}🏴‍☠️ PIRATE GAME${R}`)
  console.log(`${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n`)

  printMultiRoundTimeline(Agents)
  printMultiRoundStats(Agents)
  printMultiRoundInsights(Agents)
}

function printMultiRoundTimeline(agents: AgentData[]) {
  console.log(`${B}📜 Session-by-Session Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  const maxSession = Math.max(...agents.flatMap(a => a.history.map(h => h.session)))

  for (let session = 1; session <= maxSession; session++) {
    const sessionHistory = agents.flatMap(a => 
      a.history
        .filter(h => h.session === session)
        .map(h => ({ agent: a.name, ...h }))
    )

    if (sessionHistory.length === 0) continue

    console.log(`\n${B}${C}🎮 SESSION ${session}${R}`)
    
    const rounds = [...new Set(sessionHistory.map(h => h.round))].sort((a, b) => a - b)

    for (const round of rounds) {
      const roundHistory = sessionHistory.filter(h => h.round === round)

      const proposer = roundHistory.find(h => h.role === 'proposer')
      const voters = roundHistory.filter(h => h.role === 'voter')
      const yesVotes = voters.filter(h => h.choice === 1).length
      const noVotes = voters.filter(h => h.choice === 0).length

      const eliminated = roundHistory.find(h => h.result === 'ELIMINATED')

      const proposerName = proposer ? proposer.agent : '???'
      const voteStr = `${G}YES:${yesVotes}${R} ${E}NO:${noVotes}${R}`
      
      let resultStr = ''
      if (eliminated) {
        resultStr = `${E}${eliminated.agent} ELIMINATED${R}`
      } else {
        const roundContinue = roundHistory.find(h => h.result === 'ROUND_CONTINUE')
        const winner = roundHistory.find(h => h.result === 'WIN')
        
        if (roundContinue) {
          resultStr = `${Y}REJECTED → Next Round${R}`
        } else if (winner && winner.proposalAccepted) {
          resultStr = `${G}ACCEPTED${R}`
        } else {
          resultStr = `${DIM}PENDING${R}`
        }
      }

      console.log(`  ${C}├─ Round ${round}${R}: Proposer=${B}${proposerName}${R} | ${voteStr} → ${resultStr}`)
    }

    const winner = sessionHistory.find(h => h.result === 'WIN')
    if (winner) {
      const profit = winner.profit.toFixed(1)
      console.log(`  ${G}└─ Winner: ${B}${winner.agent}${R} (+${profit} ALGO)${R}`)
    } else {
      console.log(`  ${DIM}└─ No winner recorded${R}`)
    }
  }
  console.log('')
}

function printMultiRoundStats(agents: AgentData[]) {
  console.log(`${B}📊 Agent Performance${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  interface PirateStats {
    name: string
    sessions: number
    wins: number
    losses: number
    totalProfit: number
    avgProfit: number
    timesProposer: number
    proposerWins: number
    timesEliminated: number
    survivalRate: number
  }

  const stats: PirateStats[] = agents.map(a => {
    const sessions = new Set(a.history.map(h => h.session))
    const sessionsCount = sessions.size
    const wins = a.history.filter(h => h.result === 'WIN').length
    const losses = a.history.filter(h => h.result === 'LOSS').length
    const totalProfit = a.history.reduce((sum, h) => sum + h.profit, 0)
    const avgProfit = sessionsCount > 0 ? totalProfit / sessionsCount : 0
    
    const timesProposer = a.history.filter(h => h.role === 'proposer').length
    const proposerWins = a.history.filter(h => h.role === 'proposer' && h.result === 'WIN').length
    const timesEliminated = a.history.filter(h => h.result === 'ELIMINATED').length
    const survivalRate = sessionsCount > 0 ? ((sessionsCount - timesEliminated) / sessionsCount) * 100 : 0

    return {
      name: a.name,
      sessions: sessionsCount,
      wins,
      losses,
      totalProfit,
      avgProfit,
      timesProposer,
      proposerWins,
      timesEliminated,
      survivalRate
    }
  }).sort((a, b) => b.totalProfit - a.totalProfit)

  console.log('')
  console.log(`${DIM}Agent           Sessions  Wins  Elim  Profit    Avg/Game  Proposer  Survival${R}`)
  console.log(DIM + '─'.repeat(82) + R)

  for (const s of stats) {
    const nameStr = s.name.padEnd(15)
    const sessionsStr = s.sessions.toString().padStart(8)
    const winsStr = s.wins.toString().padStart(5)
    const elimStr = s.timesEliminated.toString().padStart(5)
    
    const profitColor = s.totalProfit > 0 ? G : s.totalProfit < 0 ? E : Y
    const profitStr = `${profitColor}${s.totalProfit.toFixed(1)}${R}`.padEnd(15)
    
    const avgStr = `${s.avgProfit.toFixed(1)}`.padStart(8)
    const proposerStr = `${s.timesProposer}/${s.proposerWins}`.padStart(9)
    const survivalStr = `${s.survivalRate.toFixed(0)}%`.padStart(8)

    console.log(`${nameStr} ${sessionsStr} ${winsStr} ${elimStr}  ${profitStr} ${avgStr}  ${proposerStr} ${survivalStr}`)
  }

  console.log(`\n${DIM}Proposer format: times_proposed/wins_as_proposer${R}`)
  console.log('')
}

function printMultiRoundInsights(agents: AgentData[]) {
  console.log(`${B}🧠 Strategic Insights${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  const proposerSuccess = agents.map(a => {
    const proposals = a.history.filter(h => h.role === 'proposer')
    const wins = proposals.filter(h => h.result === 'WIN').length
    return {
      name: a.name,
      proposals: proposals.length,
      wins,
      rate: proposals.length > 0 ? (wins / proposals.length) * 100 : 0
    }
  }).filter(p => p.proposals > 0).sort((a, b) => b.rate - a.rate)

  if (proposerSuccess.length > 0) {
    const best = proposerSuccess[0]
    console.log(`${G}✓${R} Best Proposer: ${B}${best.name}${R} (${best.wins}/${best.proposals} = ${best.rate.toFixed(0)}% success)`)
  }

  const eliminations = agents.map(a => ({
    name: a.name,
    count: a.history.filter(h => h.result === 'ELIMINATED').length
  })).sort((a, b) => b.count - a.count)

  if (eliminations[0].count > 0) {
    console.log(`${E}✗${R} Most Eliminated: ${B}${eliminations[0].name}${R} (${eliminations[0].count}x)`)
  }

  const votingPatterns = agents.map(a => {
    const votes = a.history.filter(h => h.role === 'voter')
    const yesVotes = votes.filter(h => h.choice === 1).length
    const total = votes.length
    return {
      name: a.name,
      yesRate: total > 0 ? (yesVotes / total) * 100 : 0,
      total
    }
  }).filter(v => v.total > 0).sort((a, b) => b.yesRate - a.yesRate)

  if (votingPatterns.length > 0) {
    const mostCooperative = votingPatterns[0]
    const leastCooperative = votingPatterns[votingPatterns.length - 1]
    
    console.log(`${G}🤝${R} Most Cooperative: ${B}${mostCooperative.name}${R} (${mostCooperative.yesRate.toFixed(0)}% YES votes)`)
    console.log(`${E}🚫${R} Most Hostile: ${B}${leastCooperative.name}${R} (${(100 - leastCooperative.yesRate).toFixed(0)}% NO votes)`)
  }

  console.log('')
}

main().catch(console.error)
