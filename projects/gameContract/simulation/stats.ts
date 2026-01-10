/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-control-regex */
import * as fs from 'fs'
import * as path from 'path'

/**
 * Represents a single game event recorded in an agent's history.
 */
interface HistoryItem {
  game: string
  session: number
  round: number
  choice: number
  result: string
  profit: number
  reasoning: string
  timestamp: string
  role?: string            // Specific to Pirate Game (Proposer/Voter)
  proposalAccepted?: boolean // Specific to Pirate Game
  roundEliminated?: number   // Specific to Pirate Game
  virtualSession?: number    // Injected at runtime to handle simulation restarts
}

/**
 * Represents the structure of an Agent's JSON log file.
 */
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

// ANSI Color Codes for Console Output
const R = '\x1b[0m'   // Reset
const G = '\x1b[32m'  // Green
const E = '\x1b[31m'  // Error/Red
const Y = '\x1b[33m'  // Yellow
const B = '\x1b[1m'   // Bold
const C = '\x1b[36m'  // Cyan
const DIM = '\x1b[2m' // Dim

const STAG_ICONS: Record<number, string> = { 1: '🦌', 0: '🐇' }
const WEEKLY_ICONS: Record<number, string> = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' }

/**
 * Injects a `virtualSession` field into history items to handle simulation restarts.
 * * Context: When running batch simulations, the blockchain environment might reset, 
 * causing session IDs to roll back to 0. This function detects these resets 
 * (chronological drop in session ID) and applies a global offset to ensure 
 * the visualization renders a linear timeline.
 */
function injectVirtualSessionIds(agents: AgentData[], gameName: string) {
  agents.forEach(agent => {
    const gameHistory = agent.history.filter(h => h.game === gameName)
    
    let baseOffset = 0
    let lastSessionId = -1
    let lastRound = -1
    let maxSessionInRun = 0

    gameHistory.forEach(h => {
      // Detect restart: session decreased OR (session same but round went back to 1 after being higher)
      const isSessionDecrease = h.session < lastSessionId
      const isRoundReset = (h.session === lastSessionId && h.round < lastRound && h.round === 1)
      
      if (isSessionDecrease || isRoundReset) {
        // A new simulation run has started; increment offset based on previous max
        baseOffset += (maxSessionInRun + 1)
        maxSessionInRun = 0
      }

      h.virtualSession = baseOffset + h.session

      lastSessionId = h.session
      lastRound = h.round
      
      if (h.session > maxSessionInRun) {
        maxSessionInRun = h.session
      }
    })
  })
}

/**
 * Main Entry Point.
 * Reads agent JSON files and generates ASCII reports for played games.
 */
async function main() {
  let files = process.argv.slice(2)
  
  // Default to simulation directory if no files provided
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
    injectVirtualSessionIds(agents, game)
    
    // PirateGame requires a complex multi-round view
    if (game === 'PirateGame') {
      printMultiRoundGameSection(agents, game)
    } else {
      printSimpleGameSection(agents, game)
    }
  }
}

/**
 * Renders the section for single-round games (RPS, StagHunt, etc.).
 */
function printSimpleGameSection(agents: AgentData[], gameName: string) {
  const gameAgents = agents.map(a => ({
    ...a,
    history: a.history.filter(h => h.game === gameName)
  })).filter(a => a.history.length > 0)

  if (gameAgents.length === 0) return

  console.log(`\n${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`)
  console.log(`${B}${C}🎮 ${gameName.toUpperCase()} - GAME HISTORY${R}`)
  console.log(`${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n`)

  printSimpleTimeline(gameAgents, gameName)
}

/**
 * Renders a matrix timeline (Agents vs Sessions) for simple games.
 */
function printSimpleTimeline(agents: AgentData[], gameName: string) {
  console.log(`${B}📜 Move History Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  const allVirtualSessions = agents.flatMap(a => 
    a.history.map(h => h.virtualSession !== undefined ? h.virtualSession : h.session)
  )
  
  if (allVirtualSessions.length === 0) return

  const minSession = Math.min(...allVirtualSessions)
  const maxSession = Math.max(...allVirtualSessions)
  
  let header = 'Agent'.padEnd(16) + '| '
  for (let i = minSession; i <= maxSession; i++) header += `G${i}`.padEnd(5)
  console.log(DIM + header + R)
  console.log(DIM + '─'.repeat(header.length) + R)

  for (const agent of agents) {
    let row = agent.name.padEnd(16) + '| '
    
    for (let vSession = minSession; vSession <= maxSession; vSession++) {
      const sessionMoves = agent.history.filter(h => 
        (h.virtualSession !== undefined ? h.virtualSession : h.session) === vSession
      )

      if (sessionMoves.length > 0) {
        const move = sessionMoves[sessionMoves.length - 1]
        let symbol = String(move.choice)

        // Apply icons if available
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

/**
 * Renders the section for the Pirate Game.
 */
function printMultiRoundGameSection(agents: AgentData[], gameName: string) {
  const gameAgents = agents.map(a => ({
    ...a,
    history: a.history.filter(h => h.game === gameName)
  })).filter(a => a.history.length > 0)

  if (gameAgents.length === 0) return

  console.log(`\n${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`)
  console.log(`${B}${C}🏴‍☠️ PIRATE GAME${R}`)
  console.log(`${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n`)

  printMultiRoundTimeline(gameAgents)
}

/**
 * Renders a detailed, session-by-session breakdown for the Pirate Game.
 * Displays rounds, proposers, voting results, and final profit distribution.
 */
function printMultiRoundTimeline(agents: AgentData[]) {
  console.log(`${B}📜 Session-by-Session Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  const allVirtualSessions = agents.flatMap(a => 
    a.history.map(h => h.virtualSession !== undefined ? h.virtualSession : h.session)
  )
  
  if (allVirtualSessions.length === 0) {
    console.log(DIM + 'No data available' + R)
    return
  }

  const uniqueSessions = [...new Set(allVirtualSessions)].sort((a, b) => a - b)
  
  for (const vSession of uniqueSessions) {
    const sessionHistory = agents.flatMap(a => 
      a.history
        .filter(h => (h.virtualSession !== undefined ? h.virtualSession : h.session) === vSession)
        .map(h => ({ agent: a.name, ...h }))
    )

    if (sessionHistory.length === 0) continue

    console.log(`\n${B}${C}🎮 SESSION ${vSession}${R}`)
    
    const rounds = [...new Set(sessionHistory.map(h => h.round))].sort((a, b) => a - b)

    // 1. Print detailed round progression
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
        const winner = roundHistory.find(h => h.result === 'WIN')

        if (winner && winner.proposalAccepted) {
          resultStr = `${G}ACCEPTED${R}`
        } else if (winner === undefined && !eliminated) {
          resultStr = `${Y}REJECTED → Next Round${R}`
        } else {
          resultStr = `${DIM}PENDING${R}`
        }
      }

      console.log(`  ${C}├─ Round ${round}${R}: Proposer=${B}${proposerName}${R} | ${voteStr} → ${resultStr}`)
    }

    // 2. Print Final Summary for the Session
    console.log(`  ${C}└─ Final Results:${R}`)
    
    // Categorize outcomes based on profit and status
    const winners = sessionHistory.filter(h => h.result === 'WIN' && h.profit > 0)
    const neutrals = sessionHistory.filter(h => h.result === 'WIN' && h.profit === 0)
    const losers = sessionHistory.filter(h => h.result === 'WIN' && h.profit < 0)
    const eliminated = sessionHistory.filter(h => h.result === 'ELIMINATED')
    
    // Deduplicate by agent name (taking the last state)
    const uniqueWinners = [...new Map(winners.map(h => [h.agent, h])).values()]
      .sort((a, b) => b.profit - a.profit)
    const uniqueNeutrals = [...new Map(neutrals.map(h => [h.agent, h])).values()]
    const uniqueLosers = [...new Map(losers.map(h => [h.agent, h])).values()]
      .sort((a, b) => a.profit - b.profit)
    const uniqueEliminated = [...new Map(eliminated.map(h => [h.agent, h])).values()]
    
    // Display Winners (Positive Profit)
    if (uniqueWinners.length > 0) {
      console.log(`     ${G}💰 Winners:${R}`)
      uniqueWinners.forEach(h => {
        const profitStr = h.profit.toFixed(1)
        console.log(`        ${B}${h.agent}${R}: ${G}+${profitStr} ALGO${R}`)
      })
    }
    
    // Display Break-even (Zero Profit)
    if (uniqueNeutrals.length > 0) {
      console.log(`     ${Y}⚖️  Break-even:${R}`)
      uniqueNeutrals.forEach(h => {
        console.log(`        ${B}${h.agent}${R}: ${DIM}±0.0 ALGO${R}`)
      })
    }
    
    // Display Losers (Negative Profit, but survived)
    if (uniqueLosers.length > 0) {
      console.log(`     ${Y}📉 Losses:${R}`)
      uniqueLosers.forEach(h => {
        const profitStr = h.profit.toFixed(1)
        console.log(`        ${B}${h.agent}${R}: ${E}${profitStr} ALGO${R}`)
      })
    }
    
    // Display Eliminated (Killed during game)
    if (uniqueEliminated.length > 0) {
      console.log(`     ${E}💀 Eliminated:${R}`)
      uniqueEliminated.forEach(h => {
        const profitStr = h.profit.toFixed(1)
        const roundInfo = h.roundEliminated ? ` (Round ${h.roundEliminated})` : ''
        console.log(`        ${B}${h.agent}${R}: ${E}${profitStr} ALGO${R}${DIM}${roundInfo}${R}`)
      })
    }
    
    console.log('') // Empty line for spacing
  }
  console.log('')
}

main().catch(console.error)
