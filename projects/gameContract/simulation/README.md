# 🤖 AI Agent Simulation System

> Multi-agent game theory experiments powered by LLMs

This system enables running automated game theory experiments with AI agents that have distinct personalities, learning capabilities, and strategic approaches.

---

## 🎯 Overview

### What is This?

A sophisticated simulation framework that:
- Deploys smart contracts on LocalNet
- Creates AI agents with unique psychological profiles
- Runs multiple game rounds automatically
- Collects and analyzes behavioral data
- Tests game theory hypotheses with machine learning

### Why AI Agents?

**Traditional Testing Limitations:**
- Humans are slow and expensive
- Hard to isolate specific strategies
- Difficult to reproduce results
- Limited sample size

**AI Agent Advantages:**
- ✅ Run 100+ rounds without interruptions
- ✅ Precise personality control
- ✅ Perfect reproducibility
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
├── games/
│   ├── IGameAdapter.ts  # Common interface
│   ├── StagHuntGame.ts  # StagHunt implementation
│   ├── GuessGame.ts     # GuessGame implementation
│   └── WeeklyGame.ts    # WeeklyGame implementation
└── data/
    └── agents/          # Persistent agent memories (JSON)
```
---

## 🧠 Agent Psychology System

### Psychological Profile

Each agent has 8 core traits (0-1 scale):

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

## 👥 Included Agent Archetypes

### 1. Alpha - The Scientist (EV Maximizer)

**Strategy**: Pure Expected Value optimization

```typescript
{
  personalityDescription: "EV Maximizer. Analyze stats strictly.",
  riskTolerance: 0.3,
  wealthFocus: 1.0,
  adaptability: 1.0,
  resilience: 1.0
}
```

**Behavior:**
- Analyzes `performanceStats` for highest `avgProfit`
- Ignores emotions and sunk costs
- Explores undersampled options for data
- Purely rational decision-making

**Best In**: Games with clear probability calculations

---

### 2. Beta - The Paranoid (Minimax)

**Strategy**: Minimize maximum loss

```typescript
{
  personalityDescription: "Minimax. Avoid worst-case scenarios.",
  riskTolerance: 0.0,
  trustInOthers: 0.0,
  adaptability: 0.2,
  resilience: 0.1
}
```

**Behavior:**
- Identifies worst possible outcome for each choice
- Chooses option with least damaging failure mode
- Bans choices that caused losses > 10 ALGO
- Assumes others will hurt them

**Best In**: High-risk games, volatile environments

---

### 3. Gamma - The Gambler (Volatility Hunter)

**Strategy**: Chase maximum payouts

```typescript
{
  personalityDescription: "Volatility Hunter. Bold strategic moves.",
  riskTolerance: 1.0,
  wealthFocus: 0.8,
  adaptability: 0.9,
  curiosity: 0.8
}
```

**Behavior:**
- Finds choice with highest single profit in history
- After loss: makes BOLDER strategic move
- After win: presses advantage
- Never plays conservatively

**Best In**: Winner-take-all games, high-variance scenarios

---

### 4. Delta - The Avenger (Tit-for-Tat)

**Strategy**: Mirror group behavior

```typescript
{
  personalityDescription: "Tit-for-Tat reciprocity.",
  riskTolerance: 0.4,
  fairnessFocus: 1.0,
  adaptability: 1.0,
  patience: 0.2
}
```

**Behavior:**
- If previous round = WIN → Cooperate this round
- If previous round = LOSS → Defect/Punish this round
- Teaches group that betrayal has consequences
- Immediate retaliation

**Best In**: Repeated games, cooperation scenarios

---

### 5. Epsilon - The Cooperator (Grim Trigger)

**Strategy**: Maximize global wealth

```typescript
{
  personalityDescription: "Systemic Cooperator. Maximize total wealth.",
  riskTolerance: 0.6,
  trustInOthers: 1.0,
  fairnessFocus: 0.9,
  wealthFocus: 0.1
}
```

**Behavior:**
- Calculates which choice maximizes TOTAL group wealth
- Always chooses high-trust options (Stag, high numbers)
- EXCEPTION: Switches to survival mode if personal wealth < 30%
- Altruistic until desperate

**Best In**: Cooperation games with shared benefits

---

### 6. Zeta - The Opportunist (Trend Follower)

**Strategy**: Copy current winners

```typescript
{
  personalityDescription: "Trend Follower. Copy winning strategies.",
  riskTolerance: 0.5,
  wealthFocus: 0.9,
  patience: 0.0,
  adaptability: 1.0
}
```

**Behavior:**
- Analyzes `winRate` and `timesChosen` in stats
- Identifies "crowd favorite" from last 3 rounds
- COPIES the winning strategy
- Drops strategies after 2 losses
- Zero loyalty to beliefs

**Best In**: Trending markets, momentum-based games

---

### 7. Eta - The Contrarian (Anti-Crowd)

**Strategy**: Bet on minority outcomes

```typescript
{
  personalityDescription: "Contrarian. Value where others aren't.",
  riskTolerance: 0.8,
  trustInOthers: 0.2,
  curiosity: 0.9,
  resilience: 0.9
}
```

**Behavior:**
- Looks at `timesChosen` in stats
- Chooses LEAST popular option
- Bets on minority having less competition
- If everyone risks → plays safe
- If everyone's safe → takes risks

**Best In**: Minority games (WeeklyGame), contrarian value plays

---

## 🎮 Game Adapters

### Interface

Each game implements:

```typescript
interface IGameAdapter {
  readonly name: string;
  
  deploy(admin: Agent): Promise<bigint>;
  startSession(dealer: Agent): Promise<bigint>;
  play_Commit(agents: Agent[], sessionId: bigint, round: number): Promise<void>;
  play_Reveal(agents: Agent[], sessionId: bigint, round: number): Promise<void>;
  resolve(dealer: Agent, sessionId: bigint, round: number): Promise<void>;
  play_Claim(agents: Agent[], sessionId: bigint, round: number): Promise<void>;
}
```

### Adapter Responsibilities

**1. Game Context (Objective Information):**
- Game rules and mechanics (same for all players)
- Current game state (round number, jackpot, etc.)
- Strategic hints and considerations (generic advice)
- Historical game data (cooperation rates, past averages, etc.)

**2. Agent Interrogation:**
- Queries each agent for their personality via `agent.profile.personalityDescription`
- Retrieves agent's learned lessons via `agent.getLessonsLearned(game)`
- Fetches recent move history via `agent.getRecentHistory(game, 3)`
- Gets current mental state via `agent.getMentalState()`

**3. Prompt Assembly:**

The adapter combines game context + agent data into a complete prompt:

```
GAME RULES: [Objective description - same for everyone]
CURRENT STATUS: [Round data, jackpot - same for everyone]
STRATEGIC HINTS: [Generic advice - same for everyone]
═══════════════════════════════════════════════════════════

YOUR PERSONALITY: [From agent.profile - unique per agent]
YOUR PARAMETERS: [From agent.getProfileSummary() - unique per agent]
═══════════════════════════════════════════════════════════

WHAT YOU'VE LEARNED: [From agent.getLessonsLearned() - unique per agent]
YOUR RECENT MOVES: [From agent.getRecentHistory() - unique per agent]
MENTAL STATE: [From agent.getMentalState() - unique per agent]
═══════════════════════════════════════════════════════════
[Decision request]
```
**Key Principle**: 
- **Game Adapter** = "What's happening in the game?" (objective context)
- **Agent** = "Who am I and what have I learned?" (subjective state)
- **Final Prompt** = Combination of bot

**4. Phase Management:**
- Handles commit/reveal/claim sequences
- Manages blockchain timing (waiting for rounds)
- Collects round results for next iteration

---

## 🚀 Running Simulations

### Prerequisites

```bash
# 1. Install Ollama
# macOS: brew install ollama
# Linux: curl https://ollama.ai/install.sh | sh

# 2. Pull LLM model
ollama pull llama3

# 3. Start Ollama server
ollama serve
```

### Quick Start

```bash
# From projects/gameContract/simulation/
npm run simulate
```

### Configuration

Edit `main.ts`:

```typescript
// Number of game rounds
const NUM_ROUNDS = 10;

// Initial funding per agent (microAlgos)
const INITIAL_FUNDING = 100_000;

// Game selection
const game = new StagHuntGame();
// const game = new GuessGame();
// const game = new WeeklyGame();
```

### Custom Agent Setup

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
  'llama3:latest'
);
```

---

## 📊 Analyzing Results

### Statistics Dashboard

```bash
npm run stats
```

**Output:**
```
🔸 GAME: STAGHUNT

Agent          | P1   P2   P3   P4   P5
───────────────────────────────────────
Alpha          | 🦌   🦌   🐇   🦌   🦌
Beta           | 🐇   🐇   🐇   🐇   🐇
Gamma          | 🦌   🦌   🦌   🐇   🦌
Delta          | 🦌   🐇   🦌   🦌   🦌
```

**Legend:**
- 🦌 = Stag (cooperation)
- 🐇 = Hare (safety)
- Green = WIN
- Red = LOSS
- Yellow = TIE

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

---

### Learning System

**Exponential Moving Average:**
```typescript
stat.avgProfit = stat.avgProfit * 0.7 + newProfit * 0.3;
```
- Recent results weighted more heavily
- Gradual adaptation to changing conditions

**Streak Detection:**
```typescript
if (consecutiveLosses >= 3 && adaptability > 0.5) {
  frustration *= 0.6;  // Reset frustration
  optimism = 0.5;      // Force strategy change
}
```

### Mental State Updates

```typescript
// After loss
if (isStubbornness) pain *= 2.0;  // Punish repeating failed moves
if (resilience > 0.7) pain *= 0.6;  // Resilient agents less affected

// After win
const recovery = 0.2 * (1 + resilience * 0.3);
frustration = Math.max(0, frustration - recovery);
```

---

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
ollama pull llama3

# Or use a different model in Agent constructor
new Agent(..., 'llama2:latest')
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

