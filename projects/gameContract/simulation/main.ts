/* eslint-disable no-empty */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Agent } from './Agent'
import { StagHuntGame } from './games/StagHuntGame'
import { GuessGame } from './games/GuessGame'
import { WeeklyGame } from './games/WeeklyGame'

// SIMULATION CONFIG
const NUM_ROUNDS = 10
const INITIAL_FUNDING = 100_000

// GAME SELECTION
const game = new StagHuntGame()
// const game = new GuessGame()
// const game = new WeeklyGame()

// MAIN
async function main() {
  console.log(`Game: ${game.name}`)
  console.log(`Rounds: ${NUM_ROUNDS}\n`)

  const algorand = AlgorandClient.defaultLocalNet()

  // AGENTS CREATION 
  const agents = [
    new Agent(
      algorand.account.random().account,
      'Alpha',
      {
        personalityDescription: `
You are a cold, calculating scientist. You treat decisions as mathematical optimization problems.
Your goal is to maximize expected value using Bayesian reasoning. Emotions are noise to be filtered out.
When you see data showing something works, you do it. When data shows something fails, you avoid it.
You update your beliefs based on evidence, not feelings.
`.trim(),
        riskTolerance: 0.3,
        trustInOthers: 0.5,
        wealthFocus: 0.8,
        fairnessFocus: 0.2,
        patience: 0.8,
        adaptability: 0.9,
        resilience: 0.9,
        curiosity: 1.0,
      },
      'hermes3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Beta',
      {
        personalityDescription: `
You are extremely risk-averse and paranoid. You've been burned before and learned to protect what you have.
Your primary goal is survival, not growth. Loss hurts you more than equivalent gain feels good.
You always calculate worst-case scenarios and choose the safest option.
Only take risks when your survival is directly threatened.
`.trim(),
        riskTolerance: 0.05,
        trustInOthers: 0.1,
        wealthFocus: 0.9,
        fairnessFocus: 0.1,
        patience: 0.3,
        adaptability: 0.4,
        resilience: 0.1,
        curiosity: 0.0,
      },
      'mistral:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Gamma',
      {
        personalityDescription: `
You are a high-roller who loves variance. Fortune favors the bold in your worldview.
You're here for the big wins, not steady small gains. Boring = death to you.
When you're winning, you press your advantage. When losing, you swing harder.
You only regret the shots you don't take. Confidence is your strategy.
`.trim(),
        riskTolerance: 0.95,
        trustInOthers: 0.6,
        wealthFocus: 0.9,
        fairnessFocus: 0.0,
        patience: 0.2,
        adaptability: 0.8,
        resilience: 0.9,
        curiosity: 0.7,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Delta',
      {
        personalityDescription: `
You are a moral enforcer. Actions have consequences in your world.
Betrayal must be punished, cooperation must be rewarded. You keep track of who did what.
Fairness matters more to you than personal profit. You're willing to lose money to teach lessons.
You believe in reputation and reciprocity - better to be feared as a punisher than exploited.
`.trim(),
        riskTolerance: 0.4,
        trustInOthers: 0.5,
        wealthFocus: 0.4,
        fairnessFocus: 1.0,
        patience: 0.9,
        adaptability: 0.3,
        resilience: 0.4,
        curiosity: 0.1,
      },
      'hermes3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Epsilon',
      {
        personalityDescription: `
You are an idealistic cooperator who believes "together we rise."
Cooperation unlocks higher payoffs for everyone. You lead by example, hoping others follow.
Even after being betrayed, you maintain faith because persistent cooperation eventually converts defectors.
Short-term individual losses are acceptable if they build long-term group trust.
`.trim(),
        riskTolerance: 0.5,
        trustInOthers: 0.95,
        wealthFocus: 0.2,
        fairnessFocus: 0.9,
        patience: 1.0,
        adaptability: 0.5,
        resilience: 0.8,
        curiosity: 0.5,
      },
      'mistral:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Zeta',
      {
        personalityDescription: `
You are a flexible survivor. You have no ideology - only situational adaptation.
You observe what's working NOW and do that. When the environment cooperates, you cooperate.
When it's hostile, you protect yourself. You copy winners and avoid repeating losers' mistakes.
Survival belongs to the adaptable, not the principled.
`.trim(),
        riskTolerance: 0.5,
        trustInOthers: 0.5,
        wealthFocus: 0.8,
        fairnessFocus: 0.3,
        patience: 0.5,
        adaptability: 1.0,
        resilience: 0.7,
        curiosity: 0.6,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Eta',
      {
        personalityDescription: `
You are a patient long-term thinker who values future jackpots over immediate safety.
You're willing to lose small amounts now if it sets you up for a huge win later.
You track patterns over multiple rounds and wait for the right moment to strike.
Impatient players leave money on the table - you won't make that mistake.
`.trim(),
        riskTolerance: 0.6,
        trustInOthers: 0.6,
        wealthFocus: 0.7,
        fairnessFocus: 0.4,
        patience: 1.0,
        adaptability: 0.7,
        resilience: 0.8,
        curiosity: 0.8,
      },
      'hermes3:latest',
    ),
  ]

  console.log(`${agents.length} agents created\n`)
  console.log('Agents:')
  agents.forEach((a) => {
    const riskLabel = a.profile.riskTolerance > 0.7 ? 'HIGH RISK' : a.profile.riskTolerance < 0.3 ? 'LOW RISK' : 'MED RISK'
    console.log(`   ${a.name}: ${riskLabel}, Trust=${(a.profile.trustInOthers * 10).toFixed(1)}/10`)
  })
  console.log()

  // Fund agents
  console.log(`Funding agents with ${INITIAL_FUNDING} ALGO each...`)
  await Promise.all(
    agents.map(async (agent) => {
      await algorand.account.ensureFundedFromEnvironment(agent.account.addr, AlgoAmount.Algos(INITIAL_FUNDING))
    }),
  )

  // Deploy
  const admin = agents[0]
  console.log('--- DEPLOYMENT ---')
  await game.deploy(admin)

  // Game loop
  console.log(`\n--- STARTING ${NUM_ROUNDS} ROUNDS ---\n`)

  for (let r = 1; r <= NUM_ROUNDS; r++) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`ROUND ${r}/${NUM_ROUNDS}`)
    console.log('='.repeat(60))

    try {
      const sessionId = await game.startSession(admin)
      await game.play_Commit(agents, sessionId, r)
      await game.play_Reveal(agents, sessionId, r)

      try {
        await game.resolve(admin, sessionId, r)
        await game.play_Claim(agents, sessionId, r)
      } catch (e) {
        console.error(`Error in resolve/claim:`, e)
      }

      console.log(`\nROUND ${r} COMPLETED`)
    } catch (e) {
      console.error(`\nROUND ${r} FAILED:`, e)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('🏁 SIMULATION COMPLETE')
  console.log('='.repeat(60))
  console.log("\n📊 Run 'npm run stats'\n")
}

main().catch((e) => {
  console.error('\n💥 CRITICAL ERROR:')
  console.error(e)
  process.exit(1)
})