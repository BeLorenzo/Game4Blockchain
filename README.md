# Game4Blockchain 🎮

> **🚧 Project in Active Development**

> **A comprehensive blockchain gaming framework on Algorand**
A secure blockchain gaming framework built on Algorand featuring anti-frontrunning games using commit-reveal pattern, interactive CLI, and AI-powered simulation system.

[![Language](https://img.shields.io/badge/language-TypeScript-blue)](https://www.typescriptlang.org/)
[![Framework](https://img.shields.io/badge/framework-AlgoKit-black)](https://github.com/algorandfoundation/algokit-cli)
[![Platform](https://img.shields.io/badge/platform-Algorand-green)](https://algorand.com)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

---

## 🎯 What Makes This Special?

This project combines three powerful components:

1. **🔒 Secure Smart Contracts** - Anti-frontrunning game framework using commit-reveal
2. **🖥️ Interactive CLI** - Play games directly from your terminal
3. **🤖 AI Simulation System** - Watch LLM agents battle in game theory experiments

---

## ⚙️ Prerequisites

Before running the project, ensure you have the following installed globally:

- **Node.js v22+**: Required to run the TypeScript environment.
- **Docker Desktop**: Essential. Must be installed and **running** to start LocalNet.
- **AlgoKit CLI**: The tool for managing the project lifecycle.
- **Ollama** (for simulations): Local LLM server for AI agents

### Installation

```bash
# Install AlgoKit
brew install algorand/tap/algokit  # macOS
# or
pipx install algokit              # Linux/Windows

# Install Ollama (for AI simulations)
# Visit: https://ollama.ai
# Then pull the model:
ollama pull llama3:latest
```

---

## 🚀 Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/BeLorenzo/Game4Blockchain
cd games4blockchain

# Navigate to the project
cd projects/gameContract

# Install dependencies
npm install
```

### 2. Start Local Blockchain

```bash
# IMPORTANT: Make sure Docker Desktop is open and running!
algokit localnet start
```

### 3. Compile

```bash
# Compile contracts
npm run build
```
### 4. Choose Your Path

#### 🎮 Option A: Play with CLI
```bash
npm run cli
```
Follow the interactive menu to deploy contracts and play games manually.
**[→ Full CLI Documentation](./projects/gameContract/cli/README.md)**

#### 🤖 Option B: Run AI Simulation

```bash
# Make sure Ollama is running first!
npm run simulation

# After simulation, view statistics
npm run stats
```

Watch AI agents with different personalities compete in game theory scenarios.

**[→ Full Simulation Documentation](./projects/gameContract/simulation/README.md)**

---

## 📚 Documentation Structure

```
📖 Documentation
├── 🏠 This README (Overview & Setup)
│
├── 📁 projects/gameContract/
│   ├── README.md           → Smart Contracts (detailed)
│   ├── cli/README.md       → CLI Usage Guide
│   └── simulation/README.md → AI Simulation Guide
```
**Navigation:**
- **[Smart Contracts Documentation →](./projects/gameContract/README.md)**
  - Game mechanics and rules
  - Commit-reveal architecture
  - How to extend the framework
  - Security features

- **[CLI Documentation →](./projects/gameContract/cli/README.md)**
  - Interactive gameplay
  - Deploy and manage games
  - Command reference

- **[Simulation Documentation →](./projects/gameContract/simulation/README.md)**
  - AI agent system
  - Run experiments
  - Analyze results

---

## 🏗️ Project Structure

```
games4blockchain/
├── projects/
│   └── gameContract/
│       ├── smart_contracts/        # On-chain game logic
│       │   ├── abstract_contract/  # Base framework
│       │   ├── RockPaperScissors/  # 2-player game
│       │   ├── weeklyGame/         # Lottery-style
│       │   ├── stagHunt/           # Cooperation game
│       │   ├── guessGame/          # Game theory classic
│       │   └── artifacts/          # Compiled TEAL
│       │
│       ├── cli/                    # Interactive terminal UI
│       │   ├── index.ts           # Main orchestrator
│       │   ├── walletManager.ts   # Algorand integration
│       │   ├── utils.ts           # Error handling
│       │   └── games/
│       │       ├── rps.ts
│       │       ├── weekly.ts
│       │       ├── stagHunt.ts
│       │       └── guessGame.ts
│       │
│       ├── simulation/            # AI agent system
│       │   ├── main.ts           # Simulation runner
│       │   ├── Agent.ts          # AI agent brain
│       │   ├── llm.ts            # LLM interface
│       │   ├── stats.ts          # Analysis tools
│       │   └── games/            # Game adapters
│       │
│       └── tests/                # 100+ test cases
│
└── README.md                     # You are here
```

---

## 🎮 Implemented Games

All games feature complete smart contracts, comprehensive tests, full CLI support, and AI simulation integration.

### 🪨 Rock Paper Scissors
**Type:** 2-player, instant resolution
**Mechanics:** Classic game with timeout protection
**Duration:** ~30 seconds
**CLI:** ✅ Complete
**Simulation:** ✅ Complete

### 📅 Weekly Game
**Type:** Multi-player, minority game
**Mechanics:** Choose a day, fewer players = bigger payout
**Duration:** ~2 minutes
**CLI:** ✅ Complete
**Simulation:** ✅ Complete

### 🦌 Stag Hunt (Assurance Game)
**Type:** Multi-player, cooperation
**Mechanics:** Cooperate to win big or play safe
**Duration:** ~2 minutes
**CLI:** ✅ Complete
**Simulation:** ✅ Complete

### 🎯 Guess Game (2/3 of Average)
**Type:** Multi-player, game theory
**Mechanics:** Guess 2/3 of average, closest wins
**Duration:** ~2 minutes
**CLI:** ✅ Complete
**Simulation:** ✅ Complete

---

## 🔒 Security Features

### Commit-Reveal Pattern
Prevents frontrunning by hiding moves until all players commit:

```
1. Commit Phase   → Send SHA256(move + salt)
2. Reveal Phase   → Send (move, salt) for verification
3. Resolution     → Contract verifies and determines winners
```

### Additional Protections
- ✅ Anti-replay attacks (player data cleanup)
- ✅ Timeline enforcement (strict phase control)
- ✅ MBR management (precise storage costs)
- ✅ Timeout mechanisms (handle non-revealing players)
- ✅ Hash verification (cryptographic proof)

---

## 🧪 Testing

The project includes comprehensive test suites:

```bash
# Run all tests
npm test

# Test specific contract
npm test RockPaperScissors
npm test weeklyGame

# Run with coverage
npm run test:coverage
```

**Test Coverage:**
- ✅ Normal gameplay flows
- ✅ Edge cases (ties, single players, etc.)
- ✅ Security scenarios (double claims, invalid reveals)
- ✅ Economic correctness (prize distribution, MBR)
- ✅ Dust and remainder handling

---

## 🤖 AI Simulation System

### What Makes It Special?

Unlike simple bots, our AI agents:
- **Think strategically** using Large Language Models
- **Learn from experience** with persistent memory
- **Adapt strategies** based on outcomes
- **Have personalities** (risk-averse, cooperative, contrarian, etc.)
- **Interact with real contracts** on LocalNet

### Example Agent Types

| Agent | Personality | Strategy |
|-------|------------|----------|
| **Alpha** | The Scientist | Pure math, Expected Value maximization |
| **Beta** | The Paranoid | Minimax, avoid worst outcomes |
| **Gamma** | The Gambler | High-risk, chases big wins |
| **Delta** | The Avenger | Tit-for-tat, reciprocity |
| **Epsilon** | The Cooperator | Maximizes group welfare |
| **Zeta** | The Opportunist | Follows winning trends |
| **Eta** | The Contrarian | Goes against the crowd |

### Running Experiments

```bash
# Choose game in simulation/main.ts
const game = new StagHuntGame()
// const game = new GuessGame()
// const game = new WeeklyGame()

# Run simulation
npm run sim

# View results
npm run stats
```

**[→ See Full Simulation Guide](./projects/gameContract/simulation/README.md)**

---

## 💻 Development Commands

### Smart Contracts

```bash
# Compile contracts
npm run build

# Deploy all contracts
npm run deploy

# Deploy specific contract
npm run deploy RockPaperScissors

# Run tests
npm test
```

### CLI

```bash
# Start interactive CLI
npm run cli

# Manual wallet (uses .env MNEMONIC)
# Random wallet (no .env, temporary)
```

### Simulation

```bash
# Run AI simulation
npm run simulation

# View statistics
npm run stats
```

---

## 🛠️ Extending the Framework

The architecture is designed for easy extension. See detailed guides in each component:

### Adding a New Game

**1. Smart Contract** ([Guide →](./projects/gameContract/README.md))
```typescript
// smart_contracts/yourGame/contract.algo.ts
export class YourGame extends GameContract {
  // Inherit commit-reveal logic
  // Add your game rules
}
```

**2. CLI Module** ([Guide →](./projects/gameContract/cli/README.md))
```typescript
// cli/games/yourGame.ts
export const YourGameModule: IGameModule = {
  id: 'YOUR_GAME',
  name: '🎲 Your Game',
  deploy, create, join, reveal, getStatus
}
```

**3. Simulation Adapter** ([Guide →](./projects/gameContract/simulation/README.md))
```typescript
// simulation/games/YourGame.ts
export class YourGame implements IGameAdapter {
  // Implement adapter interface
}
```

**4. Tests**
```typescript
// smart_contracts/yourGame/contract.e2e.spec.ts
describe('YourGame', () => {
  test('normal gameplay', async () => { /* ... */ })
  test('edge cases', async () => { /* ... */ })
})
```

---

## 🎓 What You Can Learn

This project demonstrates:

### Blockchain Development
- ✅ Algorand smart contract architecture
- ✅ Commit-reveal pattern implementation
- ✅ Box storage optimization
- ✅ MBR calculation and management
- ✅ Transaction grouping

### Game Theory
- ✅ Nash equilibrium discovery
- ✅ Cooperation vs defection dynamics
- ✅ Minority game strategies
- ✅ K-level reasoning

### AI/LLM Integration
- ✅ Prompt engineering for strategic thinking
- ✅ Memory and learning systems
- ✅ Personality modeling
- ✅ Multi-agent systems

### Software Architecture
- ✅ Clean abstraction layers
- ✅ Extensible design patterns
- ✅ Test-driven development
- ✅ Modular component structure

---

## 🐛 Troubleshooting

### Docker/LocalNet Issues

```bash
# Docker not running?
# → Make sure Docker Desktop is open

# LocalNet not starting?
algokit localnet reset
algokit localnet start
```

### Contract Deployment Issues

```bash
# Clean and rebuild
npm run build

# Reset LocalNet
algokit localnet reset
```

### Ollama Connection Issues

```bash
# Check Ollama status
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Pull model
ollama pull llama3:latest
```

### CLI/Simulation Errors

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check Node version (needs v22+)
node --version
```

---

## 📚 Resources

**Algorand:**
- [Algorand Developer Portal](https://developer.algorand.org/)
- [AlgoKit Documentation](https://github.com/algorandfoundation/algokit-cli)
- [AlgoKit Utils](https://github.com/algorandfoundation/algokit-utils-ts)

**Game Theory:**
- [Stag Hunt](https://en.wikipedia.org/wiki/Stag_hunt) - Assurance game
- [Guess 2/3 Average](https://en.wikipedia.org/wiki/Guess_2/3_of_the_average) - K-level reasoning
- [Minority Game](https://en.wikipedia.org/wiki/Minority_game) - Market dynamics

**Commit-Reveal:**
- [Commitment Schemes](https://en.wikipedia.org/wiki/Commitment_scheme)

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

---
