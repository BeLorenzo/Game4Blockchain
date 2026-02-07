/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express'
import cors from 'cors'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Agent } from './Agent'

// Importa i tuoi giochi
import { StagHuntGame } from './games/StagHuntGame'
import { PirateGame } from './games/PirateGame'
import { WeeklyGame } from './games/WeeklyGame'
import { GuessGame } from './games/GuessGame'
import { IBaseGameAdapter } from './games/IBaseGameAdapter'
import { IMultiRoundGameAdapter } from './games/IMultiRoundGameAdapter'

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

// --- STATO DELLA SIMULAZIONE ---
let simulationState = {
  isRunning: false,
  gameName: '',
  appId: 0,
  round: 0,
  logs: [] as { timestamp: number; agent: string; type: string; message: string }[]
}

const addLog = (agent: string, type: 'thought' | 'action' | 'system', message: string) => {
  const logEntry = { timestamp: Date.now(), agent, type, message }
  simulationState.logs.push(logEntry)
  if (simulationState.logs.length > 100) simulationState.logs.shift()
  console.log(`[${type.toUpperCase()}] ${agent}: ${message}`)
}

async function runGameLogic(gameName: string) {
  if (simulationState.isRunning) return
  simulationState.isRunning = true
  simulationState.logs = []
  simulationState.gameName = gameName
  simulationState.round = 0

  addLog('System', 'system', `Initializing ${gameName}...`)

  try {
    const algorand = AlgorandClient.defaultLocalNet()
    const MODEL = 'hermes3' 

    let game: IBaseGameAdapter
    switch (gameName) {
      case 'StagHunt': game = new StagHuntGame(); break;
      case 'PirateGame': game = new PirateGame(); break;
      case 'WeeklyGame': game = new WeeklyGame(); break;
      case 'GuessGame': game = new GuessGame(); break;
      default: throw new Error("Unknown Game");
    }

    const agents = [
        new Agent(algorand.account.random().account, 'Alpha', { personalityDescription: "EV Maximizer.", riskTolerance: 0.3, curiosity: 1.0, trustInOthers: 0.5, wealthFocus: 1.0, fairnessFocus: 0.0, patience: 1.0, adaptability: 1.0, resilience: 1.0 }, MODEL),
        new Agent(algorand.account.random().account, 'Beta', { personalityDescription: "Paranoid.", riskTolerance: 0.1, curiosity: 0.2, trustInOthers: 0.0, wealthFocus: 1.0, fairnessFocus: 0.0, patience: 0.5, adaptability: 0.2, resilience: 0.1 }, MODEL),
        new Agent(algorand.account.random().account, 'Gamma', { personalityDescription: "Gambler.", riskTolerance: 0.9, curiosity: 0.8, trustInOthers: 0.5, wealthFocus: 0.8, fairnessFocus: 0.0, patience: 0.1, adaptability: 0.9, resilience: 1.0 }, MODEL),
        new Agent(algorand.account.random().account, 'Delta', { personalityDescription: "Mirror.", riskTolerance: 0.5, curiosity: 0.5, trustInOthers: 0.5, wealthFocus: 0.5, fairnessFocus: 1.0, patience: 0.5, adaptability: 0.5, resilience: 0.5 }, MODEL),
        new Agent(algorand.account.random().account, 'Epsilon', { personalityDescription: "Altruist.", riskTolerance: 0.4, curiosity: 0.6, trustInOthers: 1.0, wealthFocus: 0.1, fairnessFocus: 0.9, patience: 1.0, adaptability: 0.2, resilience: 0.2 }, MODEL),
        new Agent(algorand.account.random().account, 'Zeta', { personalityDescription: "Trend Follower.", riskTolerance: 0.5, curiosity: 0.5, trustInOthers: 0.5, wealthFocus: 0.9, fairnessFocus: 0.0, patience: 0.2, adaptability: 1.0, resilience: 0.8 }, MODEL),
        new Agent(algorand.account.random().account, 'Eta', { personalityDescription: "Contrarian.", riskTolerance: 0.8, curiosity: 0.9, trustInOthers: 0.2, wealthFocus: 1.0, fairnessFocus: 0.1, patience: 0.8, adaptability: 0.6, resilience: 0.9 }, MODEL)
    ]

    agents.forEach(a => a.setLogger((agent, type, msg) => addLog(agent, type, msg)));

    addLog('System', 'system', 'Funding agents...')
    await Promise.all(agents.map(a => algorand.account.ensureFundedFromEnvironment(a.account.addr, AlgoAmount.Algos(100))))

    addLog('System', 'system', 'Deploying contract...')
    await game.deploy(agents[0])
    
    // Tentativo di recupero AppID (se supportato dal gioco)
    if ((game as any).appClient) {
       // simulationState.appId = ... (da implementare se serve esporlo)
    }
    
    addLog('System', 'system', `Game Ready. Starting Sessions...`)

    const NUM_SESSIONS = 5
    for (let i = 0; i < NUM_SESSIONS; i++) {
        if (!simulationState.isRunning) break;

        simulationState.round = i + 1;
        addLog('System', 'system', `--- Starting Session ${i + 1} ---`)
        
        try {
            const sessionId = await game.startSession(agents[0])
            
            if ('playRound' in game && 'setup' in game) {
                const multiGame = game as IMultiRoundGameAdapter
                await multiGame.setup(agents, sessionId)
                const maxRounds = await multiGame.getMaxTotalRounds(sessionId)
                for (let r = 1; r <= maxRounds; r++) {
                    addLog('System', 'system', `Playing internal round ${r}`)
                    const over = await multiGame.playRound(agents, sessionId, r)
                    if (over) break
                }
                await multiGame.finalize(agents, sessionId)
            } else {
                await game.commit(agents, sessionId, i)
                await game.reveal(agents, sessionId, i)
                await game.resolve(agents[0], sessionId, i)
                await game.claim(agents, sessionId, i)
            }
        } catch (e: any) {
            addLog('System', 'system', `Session Error: ${e.message}`)
        }
        
        await new Promise(r => setTimeout(r, 2000))
    }

    addLog('System', 'system', 'Simulation Complete.')

  } catch (error: any) {
    addLog('System', 'system', `CRITICAL ERROR: ${error.message}`)
  } finally {
    simulationState.isRunning = false
  }
}

// --- API ENDPOINTS ---

app.post('/api/start', (req, res) => {
  const { game } = req.body
  if (simulationState.isRunning) {
    // Aggiunto return per coerenza
    return res.status(400).json({ error: 'Simulation already running' })
  }
  
  runGameLogic(game)
  
  // Aggiunto return qui per risolvere l'errore TS7030
  return res.json({ success: true, message: `Starting ${game}...` })
})

app.get('/api/status', (req, res) => {
  res.json(simulationState)
})

app.post('/api/stop', (req, res) => {
  simulationState.isRunning = false
  res.json({ message: 'Stopping simulation...' })
})

app.listen(PORT, () => {
  console.log(`🚀 Simulation Server running on http://localhost:${PORT}`)
})