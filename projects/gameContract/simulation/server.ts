/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as fs from 'fs'
import * as path from 'path'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Agent } from './Agent'

// Import game implementations
import { StagHuntGame } from './games/StagHuntGame'
import { PirateGame } from './games/PirateGame'
import { WeeklyGame } from './games/WeeklyGame'
import { GuessGame } from './games/GuessGame'
import { IBaseGameAdapter } from './games/IBaseGameAdapter'
import { IMultiRoundGameAdapter } from './games/IMultiRoundGameAdapter'
import algosdk from 'algosdk'


/**
 * Override BigInt.prototype.toJSON to serialize BigInt values as strings.
 * This prevents JSON serialization errors when BigInt values are included in responses.
 */
(BigInt.prototype as any).toJSON = function () {
  return this.toString()
}

/**
 * Express application for the Game Simulation Server
 * Provides API endpoints to control game simulations, retrieve status, and access agent data.
 */
const app = express()
const PORT = 3000

// Middleware configuration
app.use(cors())
app.use(express.json())

/**
 * Global simulation state tracking the current game session
 * Includes logs with state snapshots for synchronized UI playback
 */
let simulationState = {
  isRunning: false,
  gameName: '',
  sessionId: '0', 
  round: 0,
  logs: [] as { 
    timestamp: number; 
    agent: string; 
    type: string; 
    message: string; 
    stateSnapshot: any; 
    txId?: string;
    TxType?: string; 
  } []
}

/**
 * Current game state that gets updated during simulation
 * Used to provide real-time UI updates and create state snapshots for logs
 */
let currentGameState: any = {
  sessionId: '0',
  round: 0,
  phase: 'WAITING',
  agents: {},
  pot: 0,
  threshold: 0,
  pirateData: null
}

/**
 * Adds a log entry to the simulation state with a snapshot of current game state
 * This enables synchronized playback in the frontend where logs are paired with state
 */
const addLog = (agent: string, type: 'thought' | 'action' | 'system' | 'game_event', message: string, txMetadata?: { txId?: string; txType?: string, agentName?: string }) => {
  // Create a deep copy of current game state to freeze it in time
  const snapshot = JSON.parse(JSON.stringify(currentGameState));

  const agentName = txMetadata?.agentName || agent

  const logEntry = { 
      timestamp: Date.now(), 
      agent: agentName, 
      type, 
      message,
      stateSnapshot: snapshot,
      txId: txMetadata?.txId,
      txType: txMetadata?.txType
  }
  
  simulationState.logs.push(logEntry)
  if (simulationState.logs.length > 1000) simulationState.logs.shift()
  
  // Console output with color coding
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  let color = '\x1b[37m'; // Default white
  if (type === 'system') color = '\x1b[32m'; // Green
  if (type === 'game_event') color = '\x1b[36m'; // Cyan
  if (type === 'thought') color = '\x1b[90m'; // Gray
  console.log(`${color}[${time}] [${type.toUpperCase()}] ${agentName}: ${message}\x1b[0m`)
}

/**
 * Updates the current game state with new values
 */
const updateGameState = (updates: any) => {
  currentGameState = { ...currentGameState, ...updates }
}

/**
 * Scans agent history files to determine the last session ID for a given game
 * Enables session numbering continuity across server restarts
 */
function getLastSessionId(gameName: string): number {
    const agentsDir = path.join(process.cwd(), 'simulation', 'data', 'agents');
    console.log(`[SERVER] Checking history in: ${agentsDir}`);
    
    let maxSession = 0;
    try {
        if (!fs.existsSync(agentsDir)) return 0;
        const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.json'));
        files.forEach(file => {
            const content = JSON.parse(fs.readFileSync(path.join(agentsDir, file), 'utf-8'));
            const history = content.history || [];
            history.forEach((h: any) => {
                if (h.game === gameName && h.session > maxSession) maxSession = h.session;
            });
        });
    } catch (e) { }
    return maxSession;
}

// --- API ENDPOINTS ---

/**
 * GET /api/status
 * Returns the current simulation state including logs and game state
 * Used by frontend to poll for updates
 */
app.get('/api/status', (req, res) => {
  return res.json({ ...simulationState, gameState: currentGameState })
})

/**
 * POST /api/start
 * Starts a new simulation session for the specified game
 */
app.post('/api/start', (req, res) => {
  const { game } = req.body
  if (simulationState.isRunning) return res.status(400).json({ error: 'Running' })
  
  // Run game logic asynchronously
  runGameLogic(game).catch(err => {
    console.error('Logic Error:', err)
    simulationState.isRunning = false
  })
  return res.json({ success: true })
})

/**
 * GET /api/agent-stats
 * Retrieves aggregated statistics for all agents from their persistent storage
 * Returns win rates, total profits, and personality profiles
 */
app.get('/api/agent-stats', (req, res) => {
    const agentsDir = path.join(process.cwd(), 'simulation', 'data', 'agents');
    const stats: any = {};
    
    try {
        if (fs.existsSync(agentsDir)) {
            const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.json'));
            files.forEach(file => {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(agentsDir, file), 'utf-8'));
                    const history = content.history || [];
                    const profile = content.profile || {}; 

                    const totalGames = history.length;
                    const totalProfit = history.reduce((sum: number, h: any) => sum + (Number(h.profit) || 0), 0);
                    const wins = history.filter((h: any) => h.result === 'WIN').length;
                    const winRate = totalGames > 0 ? wins / totalGames : 0;

                    const personality = {
                        riskTolerance: profile.riskTolerance || 0,
                        trustInOthers: profile.trustInOthers || 0,
                        wealthFocus: profile.wealthFocus || 0,
                        fairnessFocus: profile.fairnessFocus || 0,
                        curiosity: profile.curiosity || 0
                    };

                    stats[content.name] = { 
                        totalGames, 
                        totalProfit, 
                        winRate,
                        personality 
                    };
                } catch (err) {
                    console.error(`Error processing stats for ${file}:`, err);
                }
            });
        }
    } catch (e) { console.error("Stats error", e); }
    return res.json(stats);
})

/**
 * GET /api/history/:gameId
 * Retrieves complete historical session data for a specific game
 * Groups results by session and includes all agent decisions and outcomes
 */
app.get('/api/history/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    const agentsDir = path.join(process.cwd(), 'simulation', 'data', 'agents');
    
    try {
        if (!fs.existsSync(agentsDir)) return res.json([]);
        
        const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.json'));
        let allHistory: any[] = [];

        files.forEach(file => {
            const content = JSON.parse(fs.readFileSync(path.join(agentsDir, file), 'utf-8'));
            const agentName = content.name;
            const history = (content.history || []).filter((h: any) => h.game === gameId);
            
            history.forEach((h: any) => {
                allHistory.push({
                    ...h,
                    agent: agentName,
                    timeMs: new Date(h.timestamp).getTime() || 0 
                });
            });
        });

        allHistory.sort((a, b) => a.timeMs - b.timeMs);

        const sessionMap = new Map<number, any>();
        let virtualSessionId = 0;
        let lastOriginalSession = -1;
        let seenAgentRounds = new Set<string>();

        allHistory.forEach(h => {
            const agentRoundKey = `${h.agent}-R${h.round}`;
            
            if (h.session !== lastOriginalSession || seenAgentRounds.has(agentRoundKey)) {
                virtualSessionId++;
                lastOriginalSession = h.session;
                seenAgentRounds.clear(); 
                
                sessionMap.set(virtualSessionId, {
                    session: virtualSessionId,   
                    originalSession: h.session, 
                    timestamp: h.timestamp,
                    game: gameId,
                    rounds: []
                });
            }
            
            seenAgentRounds.add(agentRoundKey);

            const currentSession = sessionMap.get(virtualSessionId);
            currentSession.rounds.push({
                round: h.round,
                agent: h.agent,
                choice: h.choice,
                result: h.result,
                profit: h.profit,
                reasoning: h.reasoning,
                role: h.role,
                proposalAccepted: h.proposalAccepted
            });
        });

        const allSessions = Array.from(sessionMap.values());
        allSessions.sort((a, b) => b.session - a.session);
        
        allSessions.forEach(session => {
            session.rounds.sort((a: any, b: any) => {
                if (a.round === b.round) return a.agent.localeCompare(b.agent);
                return a.round - b.round;
            });
        });

        return res.json(allSessions);
    } catch (e) {
        console.error("Error reading history:", e);
        return res.json([]);
    }
});


function getPersistentAccounts(count: number): algosdk.Account[] {
  const filePath = path.join(process.cwd(), 'agent-wallets.json');
  if (fs.existsSync(filePath)) {
    console.log(`Loading existing wallets from ${filePath}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.map((mnemonic: string) => algosdk.mnemonicToSecretKey(mnemonic));
  }
  console.log(`Creating ${count} new persistent wallets...`);
  const accounts = Array.from({ length: count }, () => algosdk.generateAccount());
  const mnemonics = accounts.map(acc => algosdk.secretKeyToMnemonic(acc.sk));
  
  fs.writeFileSync(filePath, JSON.stringify(mnemonics, null, 2));
  console.log(`Wallets saved to ${filePath}`);
  
  return accounts;
}

// --- SIMULATION LOGIC ---

/**
 * Main game simulation logic
 * Orchestrates the entire game lifecycle: agent creation, funding, contract deployment, and game execution
 */
async function runGameLogic(gameName: string) {
  if (simulationState.isRunning) return
  
  simulationState.isRunning = true
  simulationState.logs = [] 
  simulationState.gameName = gameName
  simulationState.round = 0
  
  currentGameState = {
    sessionId: '0', round: 0, phase: 'INITIALIZING', agents: {}, pot: 0
  }

  const isTestNet = process.env.ALGOD_NETWORK === 'testnet'; 
  const algorand = isTestNet ? AlgorandClient.testNet() : AlgorandClient.defaultLocalNet();

  const admimMnemonic = process.env.MNEMONIC || '';
  if (!admimMnemonic) throw new Error("MNEMONIC mancante in .env");
  const adminAccount = algorand.account.fromMnemonic(admimMnemonic);

  const sessionOffset = getLastSessionId(gameName);
  const visualSessionId = sessionOffset + 1;

  addLog('System', 'system', `Network: ${isTestNet ? 'TESTNET' : 'LOCALNET'} - Admin: ${adminAccount.addr.toString().substring(0,4)}...`);
  addLog('System', 'system', `Initializing ${gameName} (Session #${visualSessionId})...`)

  try {
    const MODEL = 'hermes3'
    // Instantiate the selected game adapter
    let game: IBaseGameAdapter
    switch (gameName) {
      case 'StagHunt': game = new StagHuntGame(); break;
      case 'PirateGame': game = new PirateGame(); break;
      case 'WeeklyGame': game = new WeeklyGame(); break;
      case 'GuessGame': game = new GuessGame(); break;
      default: throw new Error("Unknown Game");
    }

    // Connect game logging and state updating to server functions
    game.setLogger((msg, type, metadata) => {
      const sender = metadata?.agentName || 'Game';
      addLog(sender, type || 'game_event', msg, metadata)
    });
    if ('setStateUpdater' in game) {
        (game as any).setStateUpdater((updates: any) => {
            updateGameState(updates);
        });
    }
    
    const agentAccounts = getPersistentAccounts(7);

    // Create 7 agents with distinct game theory strategies
    const agents = [
        new Agent(
          agentAccounts[0],
          'Alpha', // THE CALCULATOR: EV Maximizer
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
          MODEL,
        ),
    
        new Agent(
          agentAccounts[1],
          'Beta', // THE PARANOID: Minimax Strategist
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
          MODEL,
        ),
    
        new Agent(
          agentAccounts[2],
          'Gamma', // THE GAMBLER: Volatility Hunter
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
            riskTolerance: 0.8,
            trustInOthers: 0.5,
            wealthFocus: 0.8,
            fairnessFocus: 0.0,
            patience: 0.1,
            adaptability: 0.9,
            resilience: 1.0,
            curiosity: 0.8,
          },
          MODEL,
        ),
    
        new Agent(
          agentAccounts[3],
          'Delta', // THE MIRROR: Tit-for-Tat Reciprocator
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
          MODEL,
        ),
    
        new Agent(
          agentAccounts[4],
          'Epsilon', // THE ALTRUIST: Group Welfare Maximizer
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
    
    STRATEGIC PRINCIPLES:
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
          MODEL,
        ),
    
        new Agent(
          agentAccounts[5],
          'Zeta', // THE FOLLOWER: Momentum Trader
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
            patience: 0.2,
            adaptability: 1.0,
            resilience: 0.8,
            curiosity: 0.5,
          },
          MODEL,
        ),
    
        new Agent(
          agentAccounts[6],
          'Eta', // THE CONTRARIAN: Anti-Crowd Strategist
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
          MODEL,
        ),
      ]

    const initialAgentState: any = {}
    agents.forEach(a => {
        initialAgentState[a.name] = { status: 'initializing', profit: 0 }
        a.setLogger((name, type, msg) => {
            const newState: any = { status: type === 'thought' ? 'thinking' : 'decided' }
            if (type === 'action') newState.lastAction = msg
            updateGameState({ agents: { ...currentGameState.agents, [name]: { ...currentGameState.agents[name], ...newState } } })
            addLog(name, type, msg)
        })
    })
    updateGameState({ agents: initialAgentState })
    
    addLog('System', 'system', 'Checking Agent Funds...');

    if (isTestNet) {
        const MIN_BALANCE = 2_000_000; 
        const TARGET_BALANCE = 3_000_000; 

        const adminSigner = algosdk.makeBasicAccountTransactionSigner(adminAccount.account);

        await Promise.all(agents.map(async (agent) => {
            try {
                const info = await algorand.account.getInformation(agent.account.addr);
                const balance = Number(info.balance);
                
                if (balance < MIN_BALANCE) {
                    const amountNeeded = TARGET_BALANCE - balance;
                    addLog('System', 'system', `💸 Funding ${agent.name} with ${(amountNeeded/1e6).toFixed(2)} ALGO...`);
                    
                    await algorand.send.payment({
                        sender: adminAccount.addr,
                        receiver: agent.account.addr,
                        amount: AlgoAmount.MicroAlgos(amountNeeded),
                        signer: adminSigner
                    });
                } else {
                    console.log(`[${agent.name}] Balance OK: ${(balance/1e6).toFixed(2)} ALGO`);
                }
            } catch (err: any) {
                addLog('System', 'system', `❌ Funding Error for ${agent.name}: ${err.message}`);
            }
        }));        
    } else {
        await algorand.account.ensureFundedFromEnvironment(adminAccount.addr, AlgoAmount.Algos(100000));
        await Promise.all(agents.map(a => algorand.account.ensureFundedFromEnvironment(a.account.addr, AlgoAmount.Algos(100000))));
    }

    addLog('System', 'system', 'Deploying contract...')
    await game.deploy(adminAccount.account, '_sim')

    updateGameState({ phase: 'DEPLOYED' })
    addLog('System', 'system', 'Contract deployed/connected.')

    // Execute the game session
    const NUM_SESSIONS = 1 
    for (let i = 0; i < NUM_SESSIONS; i++) {
        if (!simulationState.isRunning) break;

        simulationState.round = visualSessionId;
        const sessionId = await game.startSession(agents[0])
        
        simulationState.sessionId = visualSessionId.toString()
        updateGameState({ sessionId: visualSessionId.toString(), round: visualSessionId, phase: 'ACTIVE' })

        addLog('System', 'system', `=== Session ${visualSessionId} Started ===`)
        
        try {
            // Check if game is multi-round (like Pirate Game) or single-round
            if ('playRound' in game && 'setup' in game) {
                const multiGame = game as IMultiRoundGameAdapter
                await multiGame.setup(agents, sessionId)
                const maxRounds = await multiGame.getMaxTotalRounds(sessionId)
                for (let r = 1; r <= maxRounds; r++) {
                    updateGameState({ round: r, phase: 'ROUND_START' })
                    const over = await multiGame.playRound(agents, sessionId, r)
                    if (over) break
                }
                await multiGame.claim(agents, sessionId, visualSessionId)
                await multiGame.finalize(agents, sessionId)
            } else {
                // Single-round game flow: Commit -> Reveal -> Resolve -> Claim
                updateGameState({ phase: 'COMMIT' })
                await game.commit(agents, sessionId, visualSessionId) 
                updateGameState({ phase: 'REVEAL' })
                await game.reveal(agents, sessionId, visualSessionId)
                updateGameState({ phase: 'RESOLVE' })
                await game.resolve(agents[0], sessionId, visualSessionId)
                updateGameState({ phase: 'CLAIM' })
                await game.claim(agents, sessionId, visualSessionId)
            }
        } catch (e: any) {
            addLog('System', 'system', `Error: ${e.message}`)
        }
    }

    addLog('System', 'system', 'Session Completed.')
    updateGameState({ phase: 'COMPLETED' })

  } catch (error: any) {
    addLog('System', 'system', `CRITICAL: ${error.message}`)
  } finally {
    simulationState.isRunning = false
  }
}

/**
 * Starts the Express server
 */
app.listen(PORT, () => {
  console.log(`🚀 Simulation Server running on http://localhost:${PORT}`)
})