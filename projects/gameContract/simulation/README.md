# 🤖 AI Agent Simulation System

> Multi-agent game theory experiments powered by LLMs

This system enables running automated game theory experiments with AI agents that have distinct personalities, learning capabilities, and strategic approaches. It includes a headless simulation mode, a fully-featured Express API server for UI integration, and advanced CLI statistics generation.

---

## 🎯 Overview

### What is This?

A sophisticated simulation framework that:
- Deploys smart contracts on LocalNet
- Creates AI agents with unique psychological profiles and persistent memory.
- Runs multiple game rounds automatically (both single-round and multi-round negotiation games).
- Collects and analyzes behavioral data
- Provides an Express API to stream real-time state to a frontend

### Why AI Agents?
- ✅ Run 100+ rounds without interruptions
- ✅ Precise personality control
- ✅ Scales to any number of players
- ✅ Learn from experience across games

---

## 🏗️ Architecture

### Components

```
simulation/
├── main.ts              # Simulation orchestrator
├── Agent.ts             # AI agent with personality & memory
├── llm.ts               # LLM integration (Ollama)
├── stats.ts             # Results visualization
├── server.ts            # Express API server for UI integration
├── games/
│   ├── IGameAdapter.ts  # Common interface
│   ├── StagHuntGame.ts  # StagHunt implementation
│   ├── GuessGame.ts     # GuessGame implementation
│   ├── PirateGame.ts    # PirateGame implementation
│   └── WeeklyGame.ts    # WeeklyGame implementation
└── data/
    └── agents/          # Persistent agent memories (JSON)
```
---

## 🧠 Agent Psychology System

### Psychological Profile

Each agent has 8 core traits (0-1 scale). See the Agent.ts and main.ts files for the exact archetypes (Alpha, Beta, Gamma, Delta, Epsilon, Zeta, Eta).

```typescript
interface PsychologicalProfile {
  personalityDescription: string;  // Free-form description
  
  riskTolerance: number;   // 0=risk-averse, 1=risk-seeking
  trustInOthers: number;   // 0=paranoid, 1=trusting
  wealthFocus: number;     // 0=indifferent, 1=greedy
  fairnessFocus: number;   // 0=selfish, 1=altruistic
  patience: number;        // 0=short-term, 1=long-term
  adaptability: number;    // 0=stubborn, 1=flexible
  resilience: number;      // 0=fragile, 1=resilient
  curiosity: number;       // 0=conservative, 1=exploratory
}
```

### Mental State (Dynamic)

Evolves during gameplay:

```typescript
interface AgentMentalState {
  optimism: number;         // Confidence level
  frustration: number;      // Accumulated stress
  consecutiveLosses: number;
  streakCounter: number;
}
```

### Memory System

**Short-term Memory:**
- Last 5 moves
- Recent results
- Immediate patterns

**Long-term Memory:**
- Performance statistics per game
- Choice effectiveness tracking
- Historical patterns
- Lessons learned

**Persistent Storage:**
- Saved to `/data/agents/{name}.json`
- Survives across simulation runs
- Enables long-term learning

---

## 🎮 Game Adapters

The framework handles two fundamentally different types of games:

### Single-Round Game
```typescript
interface IBaseGameAdapter {
  readonly name: string

  setLogger(logger: GameLogger): void;
  setStateUpdater(updater: (updates: any) => void): void;

  deploy(deployer: Account, suffix: string): Promise<void>;
  startSession(dealer: Agent): Promise<bigint>
  commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>
  reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>
  resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void>
  claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void>
}
```
### Multi-Round Games
```typescript
interface IMultiRoundGameAdapter extends IBaseGameAdapter  {
  setup(agents: Agent[], sessionId: bigint): Promise<void>
  getMaxTotalRounds(sessionId: bigint): Promise<number>; 
  playRound(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<boolean>;
  finalize(agents: Agent[], sessionId: bigint): Promise<void>;
}
```

### Architecture & Prompt Assembly

The framework uses a strict separation of concerns when building the LLM context.


**1. The Game Adapter's Job (Objective Context):**
The adapter (e.g., `PirateGame`, `GuessGame`) is only responsible for the state of the board. It generates a `gamePrompt` containing:

* Game rules and absolute mechanics
* Current dynamic state (round number, alive players, pot size)
* Strategic generic hints

**2. The Agent's Job (Subjective Context):**
The adapter passes the `gamePrompt` to `agent.playRound(name, prompt)`. Inside the `Agent` class, the framework automatically wraps the game context with the agent's internal state using `buildFullPrompt()`:

* `profile.personalityDescription` (Core archetype)
* `getProfileSummary()` (Risk, trust, etc. on a 0-10 scale)
* `getStatsSummary(game)` (Past performance, win rates, historical ROI)
* `getRecentHistory(game)` (Last 5 moves)
* `getMentalState()` (Current optimism/frustration)

**The Final Prompt Structure (Constructed inside Agent.ts):**

```text
You are [Agent Name].

═══════════════════════════════════════════════════════════
GAME RULES AND CONTEXT
═══════════════════════════════════════════════════════════
[Injected by Game Adapter: Rules, Pot, Deadlines, Hints]

═══════════════════════════════════════════════════════════
YOUR IDENTITY AND KNOWLEDGE
═══════════════════════════════════════════════════════════
YOUR PERSONALITY: [Core traits]
YOUR PARAMETERS: [Risk tolerance, Trust, etc.]

════════ YOUR MEMORY ════════
[Injected by Agent Memory: Win rates and past ROI for choices]

YOUR RECENT MOVES: 
[Injected by Agent Memory: Last 5 choices and outcomes]

MENTAL STATE:
[Injected by Agent Psychology: Frustration levels, Loss streaks]
═══════════════════════════════════════════════════════════
[Expected JSON output format]

```

**Key Principle**:

* **Game Adapter** = *"Here are the rules and the current state of the world."*
* **Agent** = *"Here is who I am, how stressed I am, and what I learned from my past mistakes."*

**3. Phase Management:**
The adapters also handle all blockchain interactions, managing the commit/reveal sequences, waiting for block progression, calculating smart contract fees (MBR), and parsing the on-chain bytes into readable data.

---

## 🔌 API Server (`server.ts`)

The simulation can run as a backend service for a frontend UI, running on `http://localhost:3000`.

**Key Endpoints:**

* `GET /api/status`: Returns current game state and a log timeline for synchronized UI playback.
* `POST /api/start`: Starts a new simulation session for a specific game.
* `GET /api/agent-stats`: Retrieves aggregated stats (win rates, total profit) for all agents.
* `GET /api/history/:gameId`: Returns complete historical session data.

---

## 🚀 Getting Started

### Prerequisites

You need [Ollama](https://ollama.ai/) installed locally to run the LLMs.

```bash
# 1. Install Ollama
# macOS: brew install ollama
# Linux: curl https://ollama.ai/install.sh | sh

# 2. Pull the required model (Hermes 3 is default. You can pull and use others by modifying the MODEL constant in main.ts and server.ts)
ollama pull hermes3

# 3. Start Ollama server
ollama serve
```

### Running the Simulation

You can run the simulation in two ways:

**Option A: Headless CLI Mode**
Edit `main.ts` to select your game and number of rounds, then run:

```bash
npm run simulation
```

**Option B: API Server Mode (For UI)**
```bash
npm run server
```
---

### Custom Agent Setup
You can easily inject custom agents into the simulation by defining their psychological traits. Just add them to the `agents` array in `main.ts` or `server.ts`:
```typescript
const myAgent = new Agent(
  algorand.account.random().account,
  'MyAgent',
  {
    personalityDescription: `Your custom personality here`,
    riskTolerance: 0.7,
    trustInOthers: 0.5,
    wealthFocus: 0.8,
    fairnessFocus: 0.3,
    patience: 0.6,
    adaptability: 0.8,
    resilience: 0.7,
    curiosity: 0.5,
  },
  MODEL
);
```

---

## 📊 Analyzing Results
Run the built-in analytics engine to parse the agent JSONs and generate ASCII visualizations.

### Statistics Dashboard

```bash
npm run stats
```
**What it does:**

* **Single-Round Games:** Generates a matrix timeline of agent choices across all sessions.
* **Multi-Round Games:** Generates a detailed session-by-session progression tree (e.g., showing Who proposed, Voting splits, Who was eliminated, and Final profits).
* **Virtual Sessions:** Automatically detects simulation restarts/crashes and aligns session numbering for clean historical tracking.

### Data Files

Agent memories stored in `/data/agents/`:

```json
{
  "name": "Alpha",
  "profile": { ... },
  "mentalState": {
    "optimism": 0.75,
    "frustration": 0.2,
    "consecutiveLosses": 0
  },
  "history": [
    {
      "game": "StagHunt",
      "round": 5,
      "choice": 1,
      "result": "WIN",
      "profit": 12.5,
      "reasoning": "High jackpot justifies risk",
      "timestamp": "2025-12-22T10:30:45.123Z"
    }
  ],
  "performanceStats": {
    "StagHunt": {
      "1": {
        "timesChosen": 8,
        "totalProfit": 45.2,
        "avgProfit": 5.65,
        "wins": 6,
        "losses": 2,
        "winRate": 0.75
      }
    }
  }
}
```

## 🐛 Troubleshooting

### "Connection refused to Ollama"
```bash
# Start Ollama server
ollama serve

# Verify it's running
curl http://localhost:11434/api/tags
```

### "Model not found"
```bash
# Pull the model
ollama pull hermes3

# Or use a different model in Agent constructor
new Agent(..., 'llama3:latest')
```

### "Insufficient funds"
```bash
# Increase initial funding in main.ts
const INITIAL_FUNDING = 200_000;  // 200 ALGO
```

### Slow simulation
```bash
# Use smaller/faster model
ollama pull llama3:8b  # Instead of 70b

# Reduce rounds
const NUM_ROUNDS = 5;

# Use fewer agents (modify main.ts)
```

### JSON parsing errors
```bash
# LLM sometimes returns invalid JSON
# The system has automatic fallbacks to default choices
# Check console warnings for patterns
```

