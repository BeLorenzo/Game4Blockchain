# 🖥️ AlgoGame Interactive CLI

> Command-line interface for interacting with on-chain games

This tool allows you to:
* Deploy new contracts as Admin
* Simulate multiplayer matches 
* Automatically manage hashes, salts, and MBR payments

---

## 🚀 Quick Start

Make sure you've already completed the global installation in the project root.

### 1. Configure Identity (.env)

In the `projects/gameContract` folder, create or edit the `.env` file:

**Important Note:**
* **With `.env`:** The CLI always uses the same account
* **Without `.env`:** The CLI will generate a **random temporary wallet** each time you launch it
    * ✅ Perfect for **Player N** or quick tests on **LocalNet**
    * ❌ Once you close the terminal, the account and funds are lost

Example `.env`:
```ini
# Paste your mnemonic here if you want a fixed account.
# If you don't create this file, you'll use a random account.
MNEMONIC="your twenty-four word mnemonic phrase here"
```

### 2. Start LocalNet

If not already active:

```bash
algokit localnet start
```

### 3. Launch the Game

From the `projects/gameContract` folder:

```bash
npm run cli
```

## 🎮 Command Guide

### Phase 0: Deploy (Admin)

If it's your first time playing, the contract doesn't exist on the network yet.

1. Select **`🚀 Deploy New Contract`**
2. **Copy the APP ID** that appears on screen (e.g., `1005`). You'll need it for all subsequent phases

### Phase 1: Create Game

Use this option to open a new game table.

1. Select **`🆕 Create New Game Session`**
2. Enter the contract's **App ID**
3. Set the parameters (cost, duration)
4. The CLI will return a **SESSION ID** (e.g., `0`)

### Phase 2: Join Game

1. Select **`👋 Join Existing Game`**
2. Enter the contract's **App ID**
3. Enter the **SESSION ID**
4. Make your secret move
5. ⚠️ **IMPORTANT:** The CLI will show you a **SECRET SALT**. Copy it! Without it, you won't be able to prove your move and win

### Phase 3: Reveal

After the commit phase ends:

1. Select **`🔓 Reveal Move`**
2. Enter the required data (Session ID, Move, Salt)
3. The contract will verify your move

### Phase 4: Status (Dashboard)

View all active sessions and their status:

1. Select **`👀 Check Status (Dashboard)`**
2. See all games with their:
   - Phase (Waiting/Commit/Reveal/Finished)
   - Players
   - Remaining rounds
   - Prize pool

---

## 🎯 Currently Supported Games

### ✅ RockPaperScissors (RPS)

**Fully functional CLI implementation**

- Deploy new contracts
- Create game sessions
- Join as Player 1 or Player 2
- Reveal moves
- Claim timeout victories
- View game status and history

**Available Commands:**
```bash
Deploy Contract   → Deploys RPS smart contract
Create Session    → Opens new game table
Join Game         → Commit your move (Rock/Paper/Scissors)
Reveal Move       → Show your move after commit phase
Claim Timeout     → Win by default if opponent doesn't reveal
Status Dashboard  → View all active games
```

**Example Workflow:**
```bash
# Terminal 1 (Player 1 with .env)
npm run cli
> Deploy New Contract          # Copy APP ID: 1005
> Create New Game Session      # Copy SESSION ID: 0
> Join Game                    # Choose Rock, save salt
> Reveal Move                  # Paste salt, reveal Rock

# Terminal 2 (Player 2 without .env - random account)
npm run cli
> Join Game                    # Use APP ID 1005, SESSION 0
> Reveal Move                  # Reveal Paper → WINS!
```

---

## 🚧 Games in Development

### ⏳ StagHunt

**Status**: Smart contract complete, CLI integration pending

### ⏳ GuessGame

**Status**: Smart contract complete, CLI integration pending

### ⏳ WeeklyGame

**Status**: Smart contract complete, CLI integration pending

---

## 🛠️ Technical Details

### Architecture

```
cli/
├── index.ts              # Main entry point
├── interfaces.ts         # IGameModule interface
├── gameRegistry.ts       # Plugin system for games
├── walletManager.ts      # Account & funding management
├── ui.ts                 # Interactive menus (Inquirer)
├── utils.ts              # Shared utilities
└── games/
    ├── rps.ts           # RockPaperScissors (COMPLETE)
    ├── stagHunt.ts      # StagHunt (TODO)
    ├── guessGame.ts     # GuessGame (TODO)
    └── weekly.ts        # WeeklyGame (TODO)
```

### Plugin System

Each game implements the `IGameModule` interface:

```typescript
interface IGameModule {
  id: string;
  name: string;
  
  deploy(wallet: WalletManager): Promise<void>;
  create(wallet: WalletManager): Promise<void>;
  join(wallet: WalletManager): Promise<void>;
  reveal(wallet: WalletManager): Promise<void>;
  getStatus(wallet: WalletManager): Promise<void>;
}
```

This allows adding new games without modifying the core CLI code.

### Security Features

**Hash Calculation:**
```typescript
// Client-side (NEVER sent to chain)
const salt = crypto.randomBytes(32);
const choiceBytes = algosdk.encodeUint64(choice);
const hash = sha256(choiceBytes + salt);

// Blockchain receives only the hash
await client.joinSession({ commit: hash, ... });
```

**MBR Automation:**
- CLI automatically queries contract for exact MBR requirements
- Creates separate payment transactions
- Handles both session creation and player join costs

**Error Handling:**
- User-friendly error messages
- Clear instructions for common issues

---

## 🎨 UI Features

### Color-Coded Status

- 🟢 **Green**: Active/Open phases
- 🟡 **Yellow**: Waiting/Transitioning
- 🔴 **Red**: Closed/Expired
- 🏁 **Finished**: Game completed

### Smart Prompts

- Validates APP IDs (checks if contract exists)
- Auto-calculates fees from on-chain data
- Shows remaining rounds for each phase
- Warns about expired sessions

---

## 🐛 Troubleshooting

### "Insufficient funds"
```bash
# LocalNet auto-funds up to 10 ALGO
# For more, add to .env:
MNEMONIC="your funded account mnemonic"
```

### "Session does not exist"
```bash
# Double-check:
# 1. APP ID is correct
# 2. SESSION ID exists (use Status Dashboard)
# 3. LocalNet is running
```

### "Hash mismatch"
```bash
# Ensure:
# 1. You're using the EXACT salt from Join phase
# 2. You're revealing the SAME choice
# 3. No extra spaces in salt (copy carefully)
```

### "Game is over"
```bash
# Check phase timing:
# - Use Status Dashboard to see remaining rounds
# - Commit must be before endCommitAt
# - Reveal must be before endRevealAt
```
---


