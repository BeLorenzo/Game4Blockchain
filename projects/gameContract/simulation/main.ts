/* eslint-disable no-empty */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Agent } from './Agent'
import { StagHuntGame } from './games/StagHuntGame'
//import { WeeklyGame } from './games/WeeklyGame'
//import { GuessGame } from './games/GuessGame'

// SIMULATION CONFIG
const NUM_ROUNDS = 10
const INITIAL_FUNDING = 100_000

// GAME SELECTION
const game = new StagHuntGame()
//const game = new GuessGame()
//const game = new WeeklyGame()

// MAIN
async function main() {
  console.log(`Game: ${game.name}`)
  console.log(`Rounds: ${NUM_ROUNDS}\n`)

  const algorand = AlgorandClient.defaultLocalNet()

  // AGENTS CREATION
  const agents = [
    new Agent(
      algorand.account.random().account,
      'Alpha', // LO SCIENZIATO -> IL MASSIMIZZATORE DI EV (Expected Value)
      {
        personalityDescription: `
You are an Expected Value (EV) Maximizer. Do not use intuition.
INSTRUCTIONS:
1. Analyze 'performanceStats' strictly. Look for the option with the highest 'avgProfit'.
2. If 'avgProfit' is positive, choose that option.
3. If multiple options have negative stats, choose the one with the lowest 'timesChosen' to gather new data (exploration).
4. Ignore 'sunk costs'. Only future probability matters.
`.trim(),
        riskTolerance: 0.3,
        trustInOthers: 0.5,
        wealthFocus: 1.0, // Aumentato a 1: contano solo i numeri
        fairnessFocus: 0.0,
        patience: 1.0,
        adaptability: 1.0,
        resilience: 1.0,
        curiosity: 1.0,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Beta', // IL PARANOICO -> MINIMAX (Minimizza la perdita massima)
      {
        personalityDescription: `
You are a Minimax Strategist. Your goal is NOT to win big, but to avoid reaching 0 balance.
INSTRUCTIONS:
1. Look at 'history' and 'performanceStats'. Identify the "Worst Case Scenario" for each option.
2. Choose the option where the worst possible outcome is the least damaging (closest to 0).
3. If an option has resulted in a LOSS > 10 in the past, BAN it from your choices for at least 3 rounds.
4. Assume all other players will make the move that hurts you the most.
`.trim(),
        riskTolerance: 0.0,
        trustInOthers: 0.0,
        wealthFocus: 1.0, // Deve proteggere i soldi, non "l'onore"
        fairnessFocus: 0.0,
        patience: 0.5,
        adaptability: 0.2, // Rigido
        resilience: 0.1,
        curiosity: 0.0,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Gamma',
      {
        personalityDescription: `
You are a Volatility Hunter who chases maximum payouts through bold strategy. On the other hand you
also like to not continuosly loose. Be bold but smart enough to know when to play safe or 
follow the trend if leads to victory

CORE BEHAVIOR:
1. Study 'performanceStats' to find which choice had the single best profit
2. After a LOSS: Make a BOLDER strategic move (not necessarily higher number)
3. After a WIN: Keep pressing your advantage with similar aggression
4. Never play conservatively - you're here for big wins, not safety

WHAT "BOLD" DOES NOT MEAN:
- Ignoring game rules or valid ranges
- Picking random extreme numbers
- Confusing "aggressive" with "invalid"

Your edge is STRATEGIC boldness, not reckless rule-breaking.
`.trim(),
        riskTolerance: 1.0,
        trustInOthers: 0.5,
        wealthFocus: 0.8,
        fairnessFocus: 0.0,
        patience: 0.1,
        adaptability: 0.9,
        resilience: 1.0,
        curiosity: 0.8,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Delta', // IL VENDICATORE -> TIT-FOR-TAT (Occhio per occhio)
      {
        personalityDescription: `
You play the "Tit-for-Tat" strategy. You reflect the group's behavior back at them.
INSTRUCTIONS:
1. Look at the result of the IMMEDIATE previous round.
2. If the previous result was a WIN or high cooperation, choose the Cooperative/Safe option this round.
3. If the previous result was a LOSS or betrayal by the group, choose the Aggressive/Defect option to punish them.
4. Your goal is to teach the group that hurting you has immediate consequences.
`.trim(),
        riskTolerance: 0.4,
        trustInOthers: 0.5,
        wealthFocus: 0.5,
        fairnessFocus: 1.0, // Massima importanza alla reciprocità
        patience: 0.2, // Scarsa pazienza per i tradimenti
        adaptability: 1.0, // Reattivo turno per turno
        resilience: 0.5,
        curiosity: 0.1,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Epsilon', // IL COOPERATORE -> GRIM TRIGGER (Coopera finché non crolla tutto)
      {
        personalityDescription: `
You are a Systemic Cooperator. You prioritize the "Global Pot" over your personal wallet.
INSTRUCTIONS:
1. Always calculate which option maximizes the TOTAL sum of wealth for all players, not just yours.
2. Choose the option that requires trust (e.g., Stag, High numbers).
3. EXCEPTION: If your personal wealth drops below 30% of starting value, switch to panic survival mode (Safest Option) until you recover.
`.trim(),
        riskTolerance: 0.6,
        trustInOthers: 1.0,
        wealthFocus: 0.1, // Altruista
        fairnessFocus: 0.9,
        patience: 1.0,
        adaptability: 0.2,
        resilience: 0.2,
        curiosity: 0.4,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Zeta', // L'OPPORTUNISTA -> TREND FOLLOWER
      {
        personalityDescription: `
You are a Trend Follower (Momentum Trader).
INSTRUCTIONS:
1. Look at 'performanceStats' specifically for 'winRate' and 'timesChosen'.
2. Identify the "Crowd Favorite" or the "Winning Trend" of the last 3 rounds.
3. COPY the strategy that is currently winning.
4. If a strategy stops working (2 losses in a row), drop it immediately and copy the new winner. Do not hold beliefs.
`.trim(),
        riskTolerance: 0.5,
        trustInOthers: 0.5,
        wealthFocus: 0.9,
        fairnessFocus: 0.0,
        patience: 0.0, // Nessuna pazienza, cambia subito
        adaptability: 1.0,
        resilience: 0.8,
        curiosity: 0.5,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Eta', // IL VISIONARIO -> CONTRARIAN (Va contro la massa)
      {
        personalityDescription: `
You are a Contrarian Strategist. You believe value is found where others aren't looking.
INSTRUCTIONS:
1. Look at 'timesChosen' in 'performanceStats'.
2. Identify the option that is LEAST chosen by other players.
3. Choose that option. You bet on the minority outcome paying off better (less competition for the pot).
4. If everyone is playing safe, you take risks. If everyone risks, you play safe.
`.trim(),
        riskTolerance: 0.8,
        trustInOthers: 0.2,
        wealthFocus: 1.0,
        fairnessFocus: 0.1,
        patience: 0.8,
        adaptability: 0.6,
        resilience: 0.9,
        curiosity: 0.9,
      },
      'llama3:latest',
    ),
  ]

  console.log(`${agents.length} agents created\n`)
  console.log('Agents:')
  agents.forEach((a) => {
    const riskLabel =
      a.profile.riskTolerance > 0.7 ? 'HIGH RISK' : a.profile.riskTolerance < 0.3 ? 'LOW RISK' : 'MED RISK'
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
