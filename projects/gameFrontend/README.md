# 🎮 Game4Blockchain Frontend
> A React + Vite Web Application for Interactive Game Theory and AI Agent Simulation on Algorand.

This project serves as the unified frontend for the **Game4Blockchain** ecosystem. It was initially generated using AlgoKit and has been extensively expanded to support two main modes of operation:
1. **🕹️ Interactive Mode**: Play blockchain-based game theory games (Stag Hunt, Pirate Game, etc.) using your own Web3 Wallet.
2. **🤖 AI Simulation Dashboard**: Watch LLM-powered agents play against each other in real-time, complete with live logs, state matrices, and performance stats.

---
## 🛠️ Setup & Configuration

### 1. Environment Variables
This project requires a `.env` file to link to the Algorand blockchain and the Game Smart Contracts.

```bash
cp .env.template .env
```

### 2. Choose Your Network
Open the newly created `.env` file. You have two options:

#### 🏠 Option A: LocalNet (Developers)
*Recommended for development and running your own simulations.*

1. Ensure `VITE_ALGOD_NETWORK=localnet` is active.
2. Deploy the contracts using the CLI in `projects/gameContract` or the `npm run deploy` command.
3. **Manually copy** the resulting App IDs into this file:

```env
VITE_RPS_APP_ID=1001
VITE_GUESSGAME_APP_ID=1002
...
```

#### 🌍 Option B: Public TestNet (Demo)
*Recommended for quickly testing the UI without Docker.*

1. Uncomment the **TestNet** configuration in `.env`.
2. Use the **Public Demo IDs** provided in the comments of the `.env.template`:
```env
VITE_RPS_APP_ID=12345678  # Use the IDs provided in the file
```

## 🌟 Key Features & Project Structure

The frontend is modularized to cleanly separate UI components, blockchain contract calls, and simulation logic. 

### 1. Interactive Blockchain Games
Located in `src/components/games/` and driven by custom React hooks (`src/hooks/`), players can connect their wallets and play:
- **Rock Paper Scissors (RPS)**
- **Stag Hunt** (Cooperation vs. Defection)
- **Guess Game** (2/3 of the Average)
- **Weekly Game** (Minority/Congestion game)
- **Pirate Game** (Ultimatum variant, featuring complex multi-round negotiation UIs like `PirateCrewList`, `ProposalStatus`, and `MakeProposalForm`)

### 2. Live AI Simulation Dashboard
Located in `src/pages/SimulationHome.tsx` and `SimulationRunner.tsx`. 
- Connects directly to the backend Express API (`http://localhost:3000/api/status`) running from the `simulation/` directory.
- Features a `TypewriterLog` for real-time agent "thoughts" and actions.
- Displays live `BlockchainStats` and agent win-rates.

### Directory Overview
```text
projects/gameFrontend/
├── src/
│   ├── components/      # Reusable UI (Buttons, Navbar, Layouts)
│   │   ├── common/      # Shared game UI (Stats, Filters, SessionCards)
│   │   └── games/       # Game-specific UI (PirateGame, GuessGame, etc.)
│   ├── contracts/       # AlgoKit generated TypeScript clients (ARC-32)
│   ├── context/         # React Contexts (e.g., AlertContext)
│   ├── hooks/           # Custom React hooks for interacting with contracts
│   ├── pages/           # Main page views (SimulationHome, SimulationRunner)
│   └── utils/           # Helpers (Address truncation, formatting)
└── ...

```
---

## 🚀 Setup & Development Workflow

### 1. Initial Setup

Ensure the following pre-requisites are installed:

* **npm**: Node package manager (`npm -v` to see version `18.12`+).
* **AlgoKit CLI**: Install from [AlgoKit CLI Installation Guide](https://github.com/algorandfoundation/algokit-cli#install). Verify with `algokit --version`.

Run the following commands within the `gameFrontend` folder:

```bash
# Install dependencies
npm install
```
### 2. Environment Variables (.env)

For the **Interactive Mode** to work, the frontend needs to know exactly which smart contracts to communicate with. After deploying your games on LocalNet (or TestNet), you must save their respective Application IDs in this file:

```env
# Algorand LocalNet Nodes
VITE_ALGOD_SERVER=http://localhost:4001
VITE_INDEXER_SERVER=http://localhost:8980
VITE_KMD_SERVER=http://localhost:4002

# Interactive Games App IDs (Replace with your actual deployed IDs)
VITE_APP_ID_PIRATE_GAME=1001
VITE_APP_ID_STAG_HUNT=1002
VITE_APP_ID_GUESS_GAME=1003
VITE_APP_ID_WEEKLY_GAME=1004
```
### 3. Running the App

To start the Vite development server:

```bash
npm run dev

```
#### Running the Full Stack (LocalNet + Server + UI)

To get the full experience (especially for the Simulation Dashboard):

1. Start AlgoKit LocalNet: `algokit localnet start`
2. Start the AI Simulation Server: `npm run server` (from the `simulation` folder)
3. Start the Frontend: `npm run dev` (from the `gameFrontend` folder)

---

## 👛 Algorand Wallet Integrations

The template comes with [`use-wallet`](https://github.com/txnlab/use-wallet) integration, providing a React hook for connecting to Algorand wallet providers. Included by default:

**LocalNet:**

* [KMD/Local Wallet](https://github.com/TxnLab/use-wallet#kmd-algorand-key-management-daemon) - Perfect for testing. Features a custom `KmdSwitcher` component to easily swap between local test accounts.

**TestNet / MainNet:**

* [Pera Wallet](https://perawallet.app)
* [Defly Wallet](https://defly.app)

---

## 🛠️ Tools & Stack

This project makes use of React and Tailwind to provide a fast, responsive UI for your Algorand dApps:

* [Vite](https://vitejs.dev/) - Next Generation Frontend Tooling.
* [React](https://reactjs.org/) - UI Library.
* [Tailwind CSS](https://tailwindcss.com/) & [daisyUI](https://daisyui.com/) - Utility-first CSS and component library.
* [AlgoKit Utils](https://github.com/algorandfoundation/algokit-utils-ts) - Simplifies interactions with Algorand.
* [use-wallet](https://github.com/txnlab/use-wallet) - Wallet connection management.

---

## 🔗 Integrating with Smart Contracts

This project uses generated TypeScript clients for type-safe smart contract interactions.
If you update the PyTeal/Puya contracts in the backend, you can use the `algokit generate` command to create new ARC-32 compliant TypeScript clients. Once generated, simply place them in `./src/contracts` and use them inside your `src/hooks/` to call contract methods natively.

---

