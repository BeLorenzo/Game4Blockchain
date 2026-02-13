# Game4Blockchain 🎮

> **A comprehensive blockchain gaming framework on Algorand**
A secure blockchain gaming modular framework built on Algorand featuring anti-frontrunning games using commit-reveal pattern, interactive CLI, and AI-powered simulation system.

[![Language](https://img.shields.io/badge/language-TypeScript-blue)](https://www.typescriptlang.org/)
[![Framework](https://img.shields.io/badge/framework-AlgoKit-black)](https://github.com/algorandfoundation/algokit-cli)
[![Platform](https://img.shields.io/badge/platform-Algorand-green)](https://algorand.com)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

---

## 🧩 The Ecosystem (Project Structure)

This repository is a monorepo containing 4 interconnected pillars. **Click on the respective READMEs to dive into each component:**

### 1. 🔒 Smart Contracts (Core)
The on-chain truth. A secure, object-oriented framework implementing the Commit-Reveal pattern to prevent frontrunning in strategic games (Stag Hunt, Pirate Game, Minority Game, Guess 2/3m RPS).
👉 **[Read the Smart Contracts Documentation](./projects/gameContract/smart_contracts/README.md)**

### 2. 🎮 Interactive Frontend (React + Vite)
The human layer. A Web3 web application where players can connect their Algorand wallets (Pera, KMD, Defly) to play the games, or open the **Simulation Dashboard** to watch AI agents battle in real-time.
👉 **[Read the Frontend Documentation](./projects/gameFrontend/README.md)**

### 3. 🤖 AI Agent Simulation
The experiment layer. A headless server and simulation engine that creates LLM-powered agents (via Ollama) with distinct psychological profiles, tracks their long-term memories, and makes them play the on-chain games autonomously.
👉 **[Read the AI Simulation Documentation](./projects/gameContract/simulation/README.md)**

### 4. 🖥️ Command Line Interface (CLI)
Deploy contracts, manage game sessions, force timeouts, and play games directly from your terminal.
👉 **[Read the CLI Documentation](./projects/gameContract/cli/README.md)**

Every component is designed to work together, yet each can be used independently.  
All N-players games are fully implemented across **smart contracts, CLI, frontend, and simulation**.
---

## ⚙️ Prerequisites

Before running the project, ensure you have the following installed globally:

- **Node.js v22+**: Required to run the TypeScript environment.
- **Docker Desktop**: Essential. Must be installed and **running** to start LocalNet.
- **AlgoKit CLI**: The tool for managing the project lifecycle.
   ```bash
   # macOS
   brew install algorand/tap/algokit
   # Windows/Linux (via Python)
   pipx install algokit
  ```
- **Ollama** (for simulations): Local LLM server for AI agents
  ```bash
  # Download from ollama.ai, then pull the default model:
  ollama pull hermes3
  ```
---

## 🚀 Quick Start

First, lay the foundation. Then, choose how you want to experience the Game4Blockchain ecosystem.


### Phase 1: The Foundation (Mandatory)
Start the local blockchain and install the core smart contract dependencies.

```bash
# 1. Start LocalNet (IMPORTANT: Make sure Docker Desktop is running!)
algokit localnet start

# 2. Setup the core project
cd projects/gameContract
npm install

```
---

### Phase 2: Choose Your Experience

#### Path A: The Full Stack (Web UI & AI Dashboard)

Best for seeing the complete picture. Play games with your Web3 wallet or watch AI agents battle in a real-time React dashboard.

*Terminal 1 (Backend API):*

```bash
cd projects/gameContract
npm run server

```

*Terminal 2 (Frontend UI):*

```bash
cd projects/gameFrontend
npm install
npm run dev

```

**[→ Full Frontend Documentation](https://www.google.com/search?q=./projects/gameFrontend/README.md)**

#### Path B: The Terminal Way (Interactive CLI)

Best for deploying contracts as an admin, forcing timeouts, or playing games manually right from your terminal.

```bash
cd projects/gameContract
npm run cli

```

**[→ Full CLI Documentation](https://www.google.com/search?q=./projects/gameContract/cli/README.md)**

#### Path C: The AI Simulation

Best for running massive automated game theory experiments without a graphical interface.

```bash
cd projects/gameContract

# Make sure Ollama is running first! (ollama serve)
npm run simulation

# When the simulation finishes, generate the ASCII analytics
npm run stats

```

**[→ Full AI Simulation Documentation](https://www.google.com/search?q=./projects/gameContract/simulation/README.md)**

---

## Component Deep Dive

### 1. Smart Contracts (Algorand) 

A robust abstract framework written in **Algorand TypeScript** that implements the Commit‑Reveal pattern.

**Key features:**

- ✅ Client‑side SHA256 hash generation → only the hash is stored on‑chain.
- ✅ Optimized box storage, precise MBR calculation.
- ✅ Strict phase enforcement (commit/reveal) based on block rounds.
- ✅ **Pull‑based claiming**: winners explicitly claim their rewards – no automatic pushes.
- ✅ Clean inheritance: new games extend `GameContract` and only implement game‑specific logic.

**Implemented games:**

- Rock Paper Scissors -> 1v1 instant resolution. 2 Players
- Weekly Game         -> Multi‑player lottery (minority). N Players
- Stag Hunt           -> Cooperation with threshold. N Players
- Guess Game          -> 2/3 of the average. N Player
- Pirate Game         -> Treasure division, voting. 3‑20 Players

[📖 Smart Contract Documentation →](./projects/gameContract/README.md)

---

### 2. Interactive CLI 🖥️

A feature‑rich terminal interface for interacting with all games.

- **Plugin system** – Adding a new game = implement `IGameModule` and register it.
- **Smart wallet handling**:  
  - With `.env` (mnemonic) → persistent account.  
  - Without `.env` → **temporary random wallet** (perfect for quick tests, funds lost on exit).
- **Automatic hash + salt generation** – user only sees the salt to save.
- **Color‑coded dashboard** (green = active, yellow = waiting, red = closed).
- **Context‑aware prompts** (e.g., warns if App ID doesn’t exist, phase mismatch).

**Multi‑terminal testing:**  
Run the CLI in different terminals – one with a persistent admin account, others as temporary players.

[📖 CLI Documentation →](./projects/gameContract/cli/README.md)

---

### 3. React Frontend 🌐

A modern single‑page application built with **Vite, React, Tailwind CSS, and daisyUI**, originally scaffolded with AlgoKit and heavily extended.

#### 🕹️ Interactive Mode
- Connect your Algorand wallet (Pera, Defly, or KMD/Local wallet).
- Play all five games with a smooth, game‑specific UI.
- **Pirate Game** features dedicated components: `PirateCrewList`, `ProposalStatus`, `MakeProposalForm`.

#### 📊 Live Simulation Dashboard
- Connects to the Express API (`http://localhost:3000/api/status`).
- Real‑time `TypewriterLog` of agent thoughts and actions.
- Live `BlockchainStats`, win‑rate charts, and state matrices.

**Environment:**  
Deployed contract IDs are stored in `.env` (see `VITE_GAMENAME_APP_ID`)

[📖 Frontend Documentation →](./projects/gameFrontend/README.md)

---

### 4. AI Simulation System 🤖

The most advanced component – **not** a collection of deterministic bots, but real LLM agents (Ollama) with:

#### 🧠 Psychological Profiles
Each agent has 8 core traits (0‑1 scale) and a free‑text personality description:
- Risk tolerance, trust, greed/altruism, patience, adaptability, resilience, curiosity, fairness focus.

#### 💾 Persistent Memory
- **Short‑term**: last 5 moves and outcomes.
- **Long‑term**: per‑game statistics (choices, win rates, average profit).
- Data is saved to `data/agents/*.json` and reused across simulation runs → agents **learn**.

#### 🧩 Prompt Engineering
Clean separation of concerns:
- **Game Adapter** → provides objective rules and current state.
- **Agent** → wraps the game prompt with its own identity, memory, and **mental state** (optimism, frustration, streak counter).

**Final prompt structure:**
```
You are [Agent Name].

════════ GAME RULES AND CONTEXT ════════
[from adapter: rules, pot size, alive players, etc.]

════════ YOUR IDENTITY AND KNOWLEDGE ════════
YOUR PERSONALITY: [description]
YOUR PARAMETERS: [risk, trust, ...]

════════ YOUR MEMORY ════════
[win rates, past ROI for each choice]
YOUR RECENT MOVES: [last 5 choices and results]
MENTAL STATE: [frustration, optimism, loss streak]

═════════════════════════════════════════════
[Expected JSON output: { choice, reasoning }]
```

#### 📡 Express API Server
- `GET /api/status` – current game state and log timeline.
- `POST /api/start` – launch a new simulation.
- `GET /api/agent-stats` – aggregated win rates / profits.
- `GET /api/history/:gameId` – full session history.

[📖 Simulation Documentation →](./projects/gameContract/simulation/README.md)

---

## 🛠️ Development & Extension

The entire codebase is built for **easy extension**.

### Adding a New Game (4 steps)

1. **Smart Contract** – Create a folder under `smart_contracts/`, extend `GameContract`, and implement your game logic.
2. **CLI** – Write a module implementing `IGameModule` and register it in `cli/index.ts`.
3. **Frontend** – Add React components in `src/components/games/` and a custom hook in `src/hooks/`.
4. **Simulation** – Create an adapter that implements `IBaseGameAdapter` (or `IMultiRoundGameAdapter`) and use it in `main.ts`.

Each component’s README contains a dedicated **extension guide** with code examples.

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

**use-wallet**: [github.com/txnlab/use-wallet](https://github.com/txnlab/use-wallet)

**Ollama**: [ollama.ai](https://ollama.ai)

**Game Theory:**
Game design inspired by classic game theory problems:  
- Stag Hunt, Guess 2/3 of the Average, Pirate Game, Minority Game.

**Commit-Reveal:**
- [Commitment Schemes](https://en.wikipedia.org/wiki/Commitment_scheme)

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

---
