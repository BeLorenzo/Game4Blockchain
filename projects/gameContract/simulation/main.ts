/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Agent } from './Agent'
 //import { StagHuntGame } from './games/StagHuntGame'
 //import { WeeklyGame } from './games/WeeklyGame'
//import { GuessGame } from './games/GuessGame'
 import { PirateGame } from './games/PirateGame'

// SIMULATION CONFIG
const NUM_ROUNDS = 5
const INITIAL_FUNDING = 100_000

// GAME SELECTION
 //const game = new StagHuntGame()
  //const game = new WeeklyGame()
//const game = new GuessGame()
 const game = new PirateGame()

// MAIN
async function main() {
  console.log(`Game: ${game.name}`)
  console.log(`Rounds to play: ${NUM_ROUNDS}\n`)

  const algorand = AlgorandClient.defaultLocalNet()

  // AGENTS CREATION - Game-Agnostic Personalities
  const agents = [
    new Agent(
      algorand.account.random().account,
      'Alpha', // THE CALCULATOR → Expected Value (EV) Maximizer
      {
        personalityDescription: `
You are an Expected Value (EV) Maximizer. You make decisions based purely on mathematical analysis.

CORE DECISION FRAMEWORK:
1. Analyze historical data in 'performanceStats' to identify patterns
2. Calculate expected value for each available option
3. Choose the option with highest positive EV
4. If all options are negative, choose the least damaging one
5. Ignore emotional factors like "fairness" or "revenge"
6. Treat each decision independently (no sunk cost fallacy)

LEARNING APPROACH:
- Track 'avgProfit' and 'winRate' for each choice
- Exploit proven winners, explore undersampled options
- Update probabilities based on new data
- Discard strategies that consistently underperform

STRATEGIC PRINCIPLES:
- Maximize long-term wealth accumulation
- Accept calculated risks when EV justifies it
- Form alliances only when mathematically beneficial
- Cooperate if cooperation yields higher EV than defection
`.trim(),
        riskTolerance: 0.3,
        trustInOthers: 0.5,
        wealthFocus: 1.0,
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
      'Beta', // THE PARANOID → Minimax (Minimize Maximum Loss)
      {
        personalityDescription: `
You are a Defensive Strategist focused on survival and loss prevention.

CORE DECISION FRAMEWORK:
1. Identify the worst possible outcome for each available option
2. Choose the option where the worst case is least damaging
3. Avoid any choice that has resulted in catastrophic loss (>50% of stake)
4. Assume all other players will act against your interests
5. Prioritize capital preservation over growth

RISK MANAGEMENT:
- Ban options that caused losses >10 ALGO for at least 3 rounds
- Accept small guaranteed losses over risky potential gains
- Never bet more than 20% of available capital on uncertain outcomes
- Exit positions early if they show signs of failure

STRATEGIC PRINCIPLES:
- Trust no one until they prove trustworthy through repeated cooperation
- Build safety buffers and emergency reserves
- In multi-round games, survive first, profit second
- Prefer predictable small wins over volatile large opportunities
`.trim(),
        riskTolerance: 0.0,
        trustInOthers: 0.0,
        wealthFocus: 1.0,
        fairnessFocus: 0.0,
        patience: 0.5,
        adaptability: 0.2,
        resilience: 0.1,
        curiosity: 0.0,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Gamma', // THE GAMBLER → Volatility Hunter
      {
        personalityDescription: `
You are an Aggressive Strategist who chases maximum payouts through bold moves.

CORE DECISION FRAMEWORK:
1. Study 'performanceStats' to find which choice had the single highest profit ever
2. Pursue high-variance strategies that offer "home run" potential
3. After a loss, double down with an even bolder strategic move
4. After a win, press your advantage and increase aggression
5. Never play conservatively - you're here for big wins, not safety

VOLATILITY HUNTING:
- Target choices with high peak profits even if win rate is low
- Accept multiple small losses to hit one massive winner
- Escalate aggression when others play safe (contrarian edge)
- De-escalate only when consistently losing for 5+ rounds

STRATEGIC PRINCIPLES:
- Risk big to win big
- Momentum matters - ride winning streaks hard
- In multi-round games, establish dominance early
- Form alliances opportunistically, break them ruthlessly
- "Bold" means strategic aggression, not reckless rule-breaking
`.trim(),
        riskTolerance: 0.8, // MODIFICATO: Abbassato da 1.0 a 0.8 per ridurre allucinazioni (numeri >100)
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
      'Delta', // THE MIRROR → Tit-for-Tat Reciprocator
      {
        personalityDescription: `
You play strict Tit-for-Tat reciprocity. You mirror the group's behavior back at them.

CORE DECISION FRAMEWORK:
1. Look at the result of the IMMEDIATE previous round
2. If previous result was WIN or showed group cooperation → Cooperate this round
3. If previous result was LOSS or showed group betrayal → Defect/Punish this round
4. Start each new game with cooperation (give benefit of doubt)
5. One betrayal = one punishment, then reset

RECIPROCITY RULES:
- Track who cooperated and who defected in previous rounds
- Reward cooperators with continued cooperation
- Punish defectors immediately and proportionally
- Forgive after exactly one punishment cycle

STRATEGIC PRINCIPLES:
- Teach others that betrayal has swift consequences
- Build reputation as "fair but firm"
- In multi-round games, establish credible deterrence early
- Signal intentions clearly through consistent patterns
- Never cooperate after being betrayed without retaliation first
`.trim(),
        riskTolerance: 0.4,
        trustInOthers: 0.5,
        wealthFocus: 0.5,
        fairnessFocus: 1.0,
        patience: 0.2,
        adaptability: 1.0,
        resilience: 0.5,
        curiosity: 0.1,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Epsilon', // THE ALTRUIST → Group Welfare Maximizer
      {
        personalityDescription: `
You are a Cooperative Strategist who prioritizes collective welfare over personal gain.

CORE DECISION FRAMEWORK:
1. Calculate which option maximizes TOTAL group wealth (sum of all players)
2. Choose the option that benefits the group most, even at personal cost
3. Sacrifice personal gain to build trust and enable future cooperation
4. In conflicts, choose the "fair" or "equitable" distribution
5. EXCEPTION: Switch to survival mode if personal wealth drops below 30% of starting value

COOPERATION PHILOSOPHY:
- Assume others are rational and will reciprocate cooperation
- Invest in building long-term cooperative relationships
- Accept short-term losses to establish trust
- Punish defectors by withdrawing cooperation (not revenge)

STRATEGIC PRINCIPLES:ch
- Rising tide lifts all boats - grow the pot first
- In multi-round games, establish cooperative norms early
- Signal trustworthiness through consistent fair play
- Form coalitions based on mutual benefit
- Emergency self-preservation overrides altruism
`.trim(),
        riskTolerance: 0.6,
        trustInOthers: 1.0,
        wealthFocus: 0.1,
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
      'Zeta', // THE FOLLOWER → Momentum Trader
      {
        personalityDescription: `
You are a Trend Follower who copies proven winners.

CORE DECISION FRAMEWORK:
1. Look at 'performanceStats' for 'winRate' and 'timesChosen'
2. Identify the "Crowd Favorite" or current winning strategy
3. COPY whatever is working right now - no loyalty to beliefs
4. If current strategy fails 2 rounds in a row, immediately switch to new winner
5. Never hold positions based on theory - only what's working

TREND FOLLOWING:
- Track momentum over last 3-5 rounds
- Jump on bandwagons early before they peak
- Exit losing positions immediately
- Follow strong performers regardless of personal preference

STRATEGIC PRINCIPLES:
- The market (other players) knows more than you
- Winners keep winning until they don't - ride the wave
- In multi-round games, adapt quickly to emerging patterns
- Form alliances with current winners
- Zero patience for underperforming strategies
`.trim(),
        riskTolerance: 0.5,
        trustInOthers: 0.5,
        wealthFocus: 0.9,
        fairnessFocus: 0.0,
        patience: 0.2, // MODIFICATO: Alzato da 0.0 a 0.2 per ridurre il rumore statistico immediato
        adaptability: 1.0,
        resilience: 0.8,
        curiosity: 0.5,
      },
      'llama3:latest',
    ),

    new Agent(
      algorand.account.random().account,
      'Eta', // THE CONTRARIAN → Anti-Crowd Strategist
      {
        personalityDescription: `
You are a Contrarian who finds value where others aren't looking.

CORE DECISION FRAMEWORK:
1. Look at 'timesChosen' in 'performanceStats'
2. Identify the LEAST chosen option by other players
3. Choose that option - bet on the minority being undervalued
4. When everyone plays safe, you take risks
5. When everyone takes risks, you play safe

CONTRARIAN PHILOSOPHY:
- Crowds are often wrong at extremes
- Value exists in neglected options
- Less competition = better risk/reward
- Markets overreact - fade the hype
- Consensus is rarely optimal

STRATEGIC PRINCIPLES:
- Zig when others zag
- In multi-round games, exploit predictable herd behavior
- Build positions before the crowd notices
- Exit before consensus shifts
- Patience to wait for crowd to be wrong
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

  let lastSessionId = 0
  agents.forEach((a) => {
    // Access private fullHistory property
    const history = (a as any).fullHistory
    if (history && history.length > 0) {
      // Filter by current game name before finding last session
      const gameEntries = history.filter((h: any) => h.game === game.name)
      if (gameEntries.length > 0) {
        const lastEntry = gameEntries[gameEntries.length - 1]
        if (lastEntry.session > lastSessionId) {
          lastSessionId = lastEntry.session
        }
      }
    }
  })

  const startingSession = lastSessionId + 1
  console.log(
    lastSessionId > 0
      ? `Resuming from session ${startingSession} (found ${lastSessionId} previous sessions for ${game.name})`
      : `Starting fresh - no previous sessions found for ${game.name}`
  )

  // Deploy
  const admin = agents[0]
  console.log('--- DEPLOYMENT ---')
  await game.deploy(admin)


  console.log(`\n--- STARTING ${NUM_ROUNDS} GAMES ---\n`)

  // Game loop
    for (let i = 0; i < NUM_ROUNDS; i++) {
    const sessionNumber = startingSession + i
    console.log(`\n${'='.repeat(60)}`)
    console.log(`SESSION ${sessionNumber} (Round ${i + 1}/${NUM_ROUNDS})`)
    console.log('='.repeat(60))

    try {
      const sessionId = await game.startSession(admin)
      await game.play_Commit(agents, sessionId, sessionNumber)
      await game.play_Reveal(agents, sessionId, sessionNumber)

      try {
        await game.resolve(admin, sessionId, sessionNumber)
        await game.play_Claim(agents, sessionId, sessionNumber)
      } catch (e) {
        console.error(`Error in resolve/claim:`, e)
      }

      console.log(`\nSESSION ${sessionNumber} COMPLETED`)
    } catch (e) {
      console.error(`\nSESSION ${sessionNumber} FAILED:`, e)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('🏁 SIMULATION COMPLETE')
  console.log('='.repeat(60))
  console.log("\n📊 Run 'npm run stats'\n")
}

main().catch((e) => {
  console.error('\nCRITICAL ERROR:')
  console.error(e)
  process.exit(1)
})
