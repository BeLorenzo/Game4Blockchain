/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-control-regex */
import * as fs from 'fs'
import * as path from 'path'

// --- INTERFACCE ---
interface HistoryItem {
  game: string
  round: number
  choice: number
  result: string
  profit: number
  timestamp: string
}

interface MentalState {
  groupTrust: number
  optimism: number
  frustration: number
}

interface AgentData {
  name: string
  profile: {
    identity: { archetype: string }
  }
  mentalState: MentalState
  history: HistoryItem[]
}

interface AgentSummary {
  Agent: string
  Games: number
  'Win %': string
  Profit: string
  Trust: string
  Mood: string
}

// --- COLORI ANSI ---
const R = '\x1b[0m' // Reset
const G = '\x1b[32m' // Green
const E = '\x1b[31m' // Red (Error/Loss)
const Y = '\x1b[33m' // Yellow
const B = '\x1b[1m' // Bold
const C = '\x1b[36m' // Cyan
const M = '\x1b[35m' // Magenta
const DIM = '\x1b[2m'

// --- MAPPE VISIVE ---
const STAG_ICONS: Record<number, string> = { 1: '🦌', 0: '🐇' }
const WEEKLY_ICONS: Record<number, string> = { 0: 'Lun', 1: 'Mar', 2: 'Mer', 3: 'Gio', 4: 'Ven', 5: 'Sab', 6: 'Dom' }

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

  if (files.length === 0) return console.log(Y + '⚠️ Nessun file trovato.' + R)

  const agents: AgentData[] = []
  files.forEach((f: any) => {
    try {
      agents.push(JSON.parse(fs.readFileSync(f, 'utf-8')))
    } catch (e) {}
  })

  printChronologicalTimeline(agents)
}

// --- 2. TIMELINE CRONOLOGICA ---
function printChronologicalTimeline(agents: AgentData[]) {
  const allGames = new Set<string>()
  agents.forEach((a) => a.history.forEach((h) => allGames.add(h.game)))

  for (const game of allGames) {
    console.log(`\n🔸 ${B}GIOCO: ${game.toUpperCase()}${R}`)

    let maxMatches = 0
    agents.forEach((a) => {
      const matchCount = a.history.filter((h) => h.game === game).length
      maxMatches = Math.max(maxMatches, matchCount)
    })

    if (maxMatches === 0) continue

    let header = 'Agent'.padEnd(16) + '| '
    for (let i = 1; i <= maxMatches; i++) header += `P${i}`.padEnd(5)
    console.log(DIM + header + R)
    console.log(DIM + '-'.repeat(header.length) + R)

    for (const agent of agents) {
      let row = agent.name.padEnd(16) + '| '
      const agentMatches = agent.history.filter((h) => h.game === game)

      for (let i = 0; i < maxMatches; i++) {
        const move = agentMatches[i]
        if (move) {
          let symbol = String(move.choice)

          if (game === 'StagHunt') symbol = STAG_ICONS[move.choice] || symbol
          if (game === 'WeeklyGame') symbol = WEEKLY_ICONS[move.choice] || symbol
          // GuessGame: Lasciamo il numero puro (es. 33)

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
  }
}

function strip(str: string) {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

main().catch(console.error)
