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
  virtualSession?: number
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
    injectVirtualSessionIds(agents, game);
    if (game === 'PirateGame') {
      printMultiRoundGameSection(agents, game)
    } else {
      printSimpleGameSection(agents, game)
    }
  }
}


function injectVirtualSessionIds(agents: AgentData[], gameName: string) {
    agents.forEach(agent => {
        const gameHistory = agent.history.filter(h => h.game === gameName);
        
        let baseOffset = 0;
        let lastSessionId = -1;
        let maxSessionInRun = 0;

        gameHistory.forEach(h => {
            if (h.session < lastSessionId) {
                baseOffset += (maxSessionInRun + 1);
                maxSessionInRun = 0; 
            }

            h.virtualSession = baseOffset + h.session;

            lastSessionId = h.session;
            if (h.session > maxSessionInRun) {
                maxSessionInRun = h.session;
            }
        });
    });
}


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

function printSimpleTimeline(agents: AgentData[], gameName: string) {
  console.log(`${B}📜 Move History Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  const allSessions = agents.flatMap(a => a.history.map(h => h.session));
  const minSessions = Math.min(...allSessions);
  const maxSessions = Math.max(...allSessions);
  
  if (allSessions.length === 0) return

  let header = 'Agent'.padEnd(16) + '| '
  for (let i = minSessions; i <= maxSessions; i++) header += `G${i}`.padEnd(5)
  console.log(DIM + header + R)
  console.log(DIM + '─'.repeat(header.length) + R)

  for (const agent of agents) {
    let row = agent.name.padEnd(16) + '| '
    
    for (let session = minSessions; session <= maxSessions; session++) {

      const sessionMoves = agent.history.filter(h => h.virtualSession === session)   

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
}

function printMultiRoundTimeline(agents: AgentData[]) {
  console.log(`${B}📜 Session-by-Session Timeline${R}`)
  console.log(DIM + '─'.repeat(80) + R)

  const allSessions = agents.flatMap(a => a.history.map(h => h.virtualSession || 0));
  const minSession = allSessions.length ? Math.min(...allSessions) : 0;
  const maxSession = allSessions.length ? Math.max(...allSessions) : 0;

  for (let session = minSession; session <= maxSession; session++) {
    const sessionHistory = agents.flatMap(a => 
      a.history
        .filter(h => h.virtualSession === session)
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

      if (winner && winner.proposalAccepted) {
          resultStr = `${G}ACCEPTED${R}`
        } else if (eliminated) {
             resultStr = `${E}REJECTED (Elimination)${R}`
        } else if (winner === undefined && !eliminated) {
             resultStr = `${Y}REJECTED → Next Round${R}`
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
      console.log(`  ${DIM}└─ End of Session Log${R}`)
    }
  }
  console.log('')
}

main().catch(console.error)
