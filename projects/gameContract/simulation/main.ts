/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Agent, PsychologicalProfile } from './Agent'
import { GuessGame } from './games/GuessGame'
import { IGameAdapter } from './games/IGameAdapter'
import { StagHuntGame } from './games/StagHuntGame'
import { WeeklyGame } from './games/WeeklyGame'

// =============================================================================
// CONFIGURAZIONE SIMULAZIONE
// =============================================================================
const CONFIG = {
  numAgents: 7,
  numRounds: 20,
  initialFunding: 100000, // ALGO per agente

  // Scegli gioco: 'GuessGame' | 'StagHunt' | 'WeeklyGame'
  gameToPlay: 'StagHunt' as const,
}

// =============================================================================
// PROFILI PSICOLOGICI (7 ARCHETIPI)
// =============================================================================
const PROFILES: PsychologicalProfile[] = [
  // 1. THE SCIENTIST - Esploratore razionale
  {
    identity: {
      selfImage: 'Detached observer',
      timeHorizon: 'long',
      archetype: 'The Scientist',
    },
    beliefs: {
      trustInOthers: 0.8,
      viewOfWorld: 'The world is a data laboratory',
    },
    values: {
      wealth: 0.1,
      fairness: 0.5,
      stability: 0.5,
      curiosity: 1.0,
    },
    risk: { aversion: 0.2, lossSensitivity: 0.1 },
    resilience: 1.0,
    adaptability: 0.9,
  },

  // 2. THE COMPUTER - Calcolatore puro
  {
    identity: {
      selfImage: 'Rational machine',
      timeHorizon: 'medium',
      archetype: 'The Computer',
    },
    beliefs: {
      trustInOthers: 0.5,
      viewOfWorld: 'Everything is an equation to solve',
    },
    values: {
      wealth: 1.0,
      fairness: 0.0,
      stability: 0.2,
      curiosity: 0.3,
    },
    risk: { aversion: 0.0, lossSensitivity: 1.0 },
    resilience: 0.6,
    adaptability: 0.2,
  },

  // 3. THE PREPPER - Sopravvissuto paranoico
  {
    identity: {
      selfImage: 'Prey in a world of predators',
      timeHorizon: 'short',
      archetype: 'The Prepper',
    },
    beliefs: {
      trustInOthers: 0.1,
      viewOfWorld: 'Everyone wants to steal my chips',
    },
    values: {
      wealth: 0.8,
      fairness: 0.1,
      stability: 1.0,
      curiosity: 0.0,
    },
    risk: { aversion: 0.95, lossSensitivity: 3.0 },
    resilience: 0.1,
    adaptability: 0.4,
  },

  // 4. THE HIGH ROLLER - Azzardatore
  {
    identity: {
      selfImage: "Fortune's chosen one",
      timeHorizon: 'short',
      archetype: 'The High Roller',
    },
    beliefs: {
      trustInOthers: 0.6,
      viewOfWorld: 'Fortune favors the bold',
    },
    values: {
      wealth: 0.9,
      fairness: 0.0,
      stability: 0.0,
      curiosity: 0.7,
    },
    risk: { aversion: 0.05, lossSensitivity: 0.2 },
    resilience: 0.9,
    adaptability: 0.8,
  },

  // 5. THE PUNISHER - Giudice morale
  {
    identity: {
      selfImage: 'Moral arbitrator',
      timeHorizon: 'long',
      archetype: 'The Punisher',
    },
    beliefs: {
      trustInOthers: 0.5,
      viewOfWorld: 'Every action has consequences',
    },
    values: {
      wealth: 0.4,
      fairness: 1.0,
      stability: 0.5,
      curiosity: 0.1,
    },
    risk: { aversion: 0.4, lossSensitivity: 1.5 },
    resilience: 0.4,
    adaptability: 0.3,
  },

  // 6. THE IDEALIST - Martire ottimista
  {
    identity: {
      selfImage: 'Savior',
      timeHorizon: 'long',
      archetype: 'The Idealist',
    },
    beliefs: {
      trustInOthers: 0.95,
      viewOfWorld: 'Together we are invincible',
    },
    values: {
      wealth: 0.2,
      fairness: 0.9,
      stability: 0.7,
      curiosity: 0.5,
    },
    risk: { aversion: 0.5, lossSensitivity: 0.8 },
    resilience: 0.8,
    adaptability: 0.5,
  },

  // 7. THE SURVIVOR - Stratega adattivo
  {
    identity: {
      selfImage: 'Social chameleon',
      timeHorizon: 'medium',
      archetype: 'The Survivor',
    },
    beliefs: {
      trustInOthers: 0.5,
      viewOfWorld: 'The best adapted win',
    },
    values: {
      wealth: 0.8,
      fairness: 0.3,
      stability: 0.6,
      curiosity: 0.6,
    },
    risk: { aversion: 0.4, lossSensitivity: 1.0 },
    resilience: 0.7,
    adaptability: 1.0,
  },
]

// Lista di modelli Ollama da distribuire tra gli agenti
const MODELS = ['gemma2:latest', 'mistral:latest', 'llama3:latest']

// =============================================================================
// FACTORY: Crea agenti con profili
// =============================================================================
function createAgents(algorand: AlgorandClient, numAgents: number): Agent[] {
  const agents: Agent[] = []
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta']

  for (let i = 0; i < numAgents; i++) {
    const account = algorand.account.random().account
    const profile = PROFILES[i % PROFILES.length]
    const model = MODELS[i % MODELS.length]
    const name = names[i]

    agents.push(new Agent(account, name, profile, model))
  }

  return agents
}

// =============================================================================
// FACTORY: Crea gioco
// =============================================================================
function createGame(gameName: string, algorand: AlgorandClient): IGameAdapter {
  switch (gameName) {
    case 'GuessGame':
      return new GuessGame()
    case 'StagHunt':
      return new StagHuntGame()
    case 'WeeklyGame':
      return new WeeklyGame()
    default:
      throw new Error(`Unknown game: ${gameName}`)
  }
}

// =============================================================================
// MAIN ORCHESTRATOR
// =============================================================================
async function main() {
  console.log('🚀 COGNITIVE AGENTS SIMULATION - SIMPLIFIED ARCHITECTURE 🚀\n')
  console.log(`Game: ${CONFIG.gameToPlay}`)
  console.log(`Agents: ${CONFIG.numAgents}`)
  console.log(`Rounds: ${CONFIG.numRounds}\n`)

  // 1. Setup Blockchain
  const algorand = AlgorandClient.defaultLocalNet()

  // 2. Crea agenti
  const agents = createAgents(algorand, CONFIG.numAgents)
  console.log(`✅ ${agents.length} agents created with psychological profiles.\n`)

  // 3. Finanziamento
  console.log(`💰 Funding agents with ${CONFIG.initialFunding} ALGO each...`)
  await Promise.all(
    agents.map(async (agent) => {
      await algorand.account.ensureFundedFromEnvironment(agent.account.addr, AlgoAmount.Algos(CONFIG.initialFunding))
    }),
  )
  console.log('✅ Funding complete.\n')

  // 4. Crea gioco
  const game = createGame(CONFIG.gameToPlay, algorand)
  const admin = agents[0]

  // 5. Deploy contratto
  console.log('--- PHASE 0: CONTRACT DEPLOYMENT ---')
  await game.deploy(admin)

  // 6. Loop di gioco
  console.log(`\n--- STARTING ${CONFIG.numRounds} ROUNDS ---\n`)

  for (let r = 1; r <= CONFIG.numRounds; r++) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`ROUND ${r}/${CONFIG.numRounds}`)
    console.log('='.repeat(60))

    try {
      const sessionId = await game.startSession(admin)
      await game.play_Commit(agents, sessionId)
      await game.play_Reveal(agents, sessionId)

      try {
        await game.resolve(admin, sessionId)
        await game.play_Claim(agents, sessionId)
      } catch (e) {
        console.error(`Error in resolve/claim phase:`, e)
      }

      console.log(`\n🏁 ROUND ${r} COMPLETED 🏁`)
    } catch (e) {
      console.error(`\n❌ ROUND ${r} FAILED:`, e)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('🏁 SIMULATION COMPLETE 🏁')
  console.log('='.repeat(60))
  console.log("\n📊 Run 'npm run stats' to analyze results.\n")
}

// =============================================================================
// ENTRY POINT
// =============================================================================
main().catch((e) => {
  console.error('\n💥 CRITICAL ERROR:')
  console.error(e)
  process.exit(1)
})
