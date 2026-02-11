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

const R = '\x1b[0m'   // Reset
const G = '\x1b[32m'  // Green
const E = '\x1b[31m'  // Error/Red
const Y = '\x1b[33m'  // Yellow
const B = '\x1b[1m'   // Bold
const C = '\x1b[36m'  // Cyan
const DIM = '\x1b[2m' // Dim

// Icon mappings for Stag Hunt and Weekly Game choices
const STAG_ICONS: Record<number, string> = { 1: '🦌', 0: '🐇' }
const WEEKLY_ICONS: Record<number, string> = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' }

/**
 * Injects virtual session IDs to handle simulation environment resets.
 * 
 * When running batch simulations, the blockchain environment may restart, causing session IDs
 * to reset to 0. This function detects chronological inconsistencies (session decreases or
 * round resets) and applies a cumulative offset to create a continuous timeline for visualization.
 */
function injectVirtualSessionIds(agents: AgentData[], gameName: string) {
  agents.forEach(agent => {
    // Filter history for the specific game
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
        maxSessionInRun = 0  // Reset for new run
      }

      // Apply virtual session ID (real session + cumulative offset)
      h.virtualSession = baseOffset + h.session

      // Update tracking variables
      lastSessionId = h.session
      lastRound = h.round
      
      // Track maximum session in current run for offset calculation
      if (h.session > maxSessionInRun) {
        maxSessionInRun = h.session
      }
    })
  })
}

/**
 * Main entry point for generating game statistics reports.
 * 
 * Reads agent JSON files. processes the data, and generates formatted ASCII reports 
 * for all detected games. Handles both simple single-round games and complex 
 * multi-round games differently.
 */
async function main() {
    let files: any[] = [] 
    const defaultDir = path.join(process.cwd(), 'simulation', 'data', 'agents')
    if (fs.existsSync(defaultDir)) {
      files = fs
        .readdirSync(defaultDir)
        .filter((f: string) => f.endsWith('.json'))
        .map((f: any) => path.join(defaultDir, f))
    }

  if (files.length === 0) {
    console.log(Y + '⚠️  No agent files found.' + R)
    return
  }

  // Load and parse all agent files
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

  // Print report header
  console.log(`\n${B}${C}╔═══════════════════════════════════════════════════════════╗${R}`)
  console.log(`${B}${C}║              GAME STATISTICS REPORT                       ║${R}`)
  console.log(`${B}${C}╚═══════════════════════════════════════════════════════════╝${R}\n`)

  // Collect all unique game names from agent histories
  const allGames = new Set<string>()
  agents.forEach((a) => a.history.forEach((h) => allGames.add(h.game)))

  console.log(`${DIM}Games detected: ${Array.from(allGames).join(', ')}${R}`)
  console.log(`${DIM}Total agents: ${agents.length}${R}\n`)

  // Process each game separately
  for (const game of allGames) {
    // Inject virtual session IDs to handle simulation restarts
    injectVirtualSessionIds(agents, game)
    
    // PirateGame requires special multi-round visualization
    if (game === 'PirateGame') {
      printMultiRoundGameSection(agents, game)
    } else {
      // All other games use simple single-round visualization
      printSimpleGameSection(agents, game)
    }
  }
}

/**
 * Renders the report section for single-round games (RockPaperScissors, StagHunt, etc.).
 * 
 * Filters agents to only those who played the specified game and displays a
 * matrix timeline of their moves across sessions.
 */
function printSimpleGameSection(agents: AgentData[], gameName: string) {
  // Filter agents to only those with history in this game
  const gameAgents = agents.map(a => ({
    ...a,
    history: a.history.filter(h => h.game === gameName)
  })).filter(a => a.history.length > 0)

  if (gameAgents.length === 0) return

  // Print game section header
  console.log(`\n${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`)
  console.log(`${B}${C}🎮 ${gameName.toUpperCase()} - GAME HISTORY${R}`)
  console.log(`${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n`)

  printSimpleTimeline(gameAgents, gameName)
}

/**
 * Renders a matrix timeline (Agents vs Sessions) for simple single-round games.
 * 
 * Creates a grid showing each agent's move choice for each session, with color coding
 * for win/loss results and game-specific icons where applicable.
 */
function printSimpleTimeline(agents: AgentData[], gameName: string) {
  console.log(`${B}📜 Move History Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  // Collect all virtual session IDs to determine timeline range
  const allVirtualSessions = agents.flatMap(a => 
    a.history.map(h => h.virtualSession !== undefined ? h.virtualSession : h.session)
  )
  
  if (allVirtualSessions.length === 0) return

  const minSession = Math.min(...allVirtualSessions)
  const maxSession = Math.max(...allVirtualSessions)
  
  // Build column headers (G0, G1, G2, etc.)
  let header = 'Agent'.padEnd(16) + '| '
  for (let i = minSession; i <= maxSession; i++) header += `G${i}`.padEnd(5)
  console.log(DIM + header + R)
  console.log(DIM + '─'.repeat(header.length) + R)

  // Build one row per agent showing their moves per session
  for (const agent of agents) {
    let row = agent.name.padEnd(16) + '| '
    
    for (let vSession = minSession; vSession <= maxSession; vSession++) {
      const sessionMoves = agent.history.filter(h => 
        (h.virtualSession !== undefined ? h.virtualSession : h.session) === vSession
      )

      if (sessionMoves.length > 0) {
        const move = sessionMoves[sessionMoves.length - 1]
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

/**
 * Renders the report section for the Pirate Game (multi-round game).
 * 
 * Pirate Game requires detailed visualization showing round-by-round progression,
 * voting results, and final profit distributions.
 */
function printMultiRoundGameSection(agents: AgentData[], gameName: string) {
  // Filter agents to only those with Pirate Game history
  const gameAgents = agents.map(a => ({
    ...a,
    history: a.history.filter(h => h.game === gameName)
  })).filter(a => a.history.length > 0)

  if (gameAgents.length === 0) return

  // Print Pirate Game section header
  console.log(`\n${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`)
  console.log(`${B}${C}🏴‍☠️ PIRATE GAME${R}`)
  console.log(`${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}\n`)

  printMultiRoundTimeline(gameAgents)
}

/**
 * Renders a detailed, session-by-session breakdown for the Pirate Game.
 * 
 * For each session, displays:
 * 1. Round-by-round progression with proposers and voting results
 * 2. Final profit distribution categorized by outcome (winners, losers, eliminated)
 */
function printMultiRoundTimeline(agents: AgentData[]) {
  console.log(`${B}📜 Session-by-Session Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  // Determine session range from all agent histories
  const allSessions = agents.flatMap(a => a.history.map(h => h.virtualSession || 0));
  const minSession = allSessions.length ? Math.min(...allSessions) : 0;
  const maxSession = allSessions.length ? Math.max(...allSessions) : 0;
  
  // Process each session separately
  for (let session = minSession; session <= maxSession; session++) {
    // Collect all history items for this session across all agents
    const sessionHistory = agents.flatMap(a => 
      a.history
        .filter(h => (h.virtualSession !== undefined ? h.virtualSession : h.session) === session)
        .map(h => ({ agent: a.name, ...h }))
    )

    if (sessionHistory.length === 0) continue

    console.log(`\n${B}${C}🎮 SESSION ${session}${R}`)
    
    // Get unique rounds in this session (sorted)
    const rounds = [...new Set(sessionHistory.map(h => h.round))].sort((a, b) => a - b)

    // Print detailed round progression
    for (const round of rounds) {
      const roundHistory = sessionHistory.filter(h => h.round === round)

      const proposer = roundHistory.find(h => h.role === 'proposer')
      const yesVotes = roundHistory.filter(h => h.choice === 1).length
      const noVotes = roundHistory.filter(h => h.choice === 0).length
      const eliminated = roundHistory.find(h => h.result === 'ELIMINATED')

      const proposerName = proposer ? proposer.agent : '???'
      const voteStr = `${G}YES:${yesVotes}${R} ${E}NO:${noVotes}${R}`
      
      // Determine round outcome
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

    console.log(`  ${C}└─ Final Results:${R}`)
    
    // Categorize outcomes based on profit and status
    const winners = sessionHistory.filter(h => h.result === 'WIN' && h.profit > 0)
    const neutrals = sessionHistory.filter(h => h.result === 'WIN' && h.profit === 0)
    const losers = sessionHistory.filter(h => h.result !== 'ELIMINATED' && h.profit < 0)
    const eliminated = sessionHistory.filter(h => h.result === 'ELIMINATED')
    
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
    
    console.log('') 
  }
  console.log('') 
}

// Execute main function with error handling
main().catch(console.error)