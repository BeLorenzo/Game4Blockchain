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
algokit localnet start   # Starts the local Algorand node
or
algokit localnet reset   # Resets the chain state (crucial between test runs)
```

### 3. Launch the CLI

From the `projects/gameContract` folder:

```bash
npm run cli
```

## 🎮 Command Guide

### Phase 0: Deploy (Admin)

If it's your first time playing, the contract doesn't exist on the network yet.

1. Select **`🚀 Deploy New Contract`**
2. **Copy the APP ID** that appears on screen (e.g., `1005`). You'll need it for all subsequent phases

### Phase 1: Create Session

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

1. Select **`🔓 Reveal Move`** (or **`🔓 Reveal Vote`** for Pirate Game) 
2. Enter the required data (Session ID, Move, Salt)
3. The contract will verify your move

### Phase 4: Check Status / Claim Prizes

View all active sessions and their status:

1. Select **`👀 Check Status (Dashboard)`**
2. See all games with their:
   - Phase (Waiting/Commit/Reveal/Finished)
   - Players
   - Remaining rounds
   - Prize pool
3. Option to claim prizes from finished games

---

## 🎯 Available Games

All games are fully functional with complete CLI integration!

### 🪨 Rock Paper Scissors

**Classic 2-player game with instant winner determination**

**Rules:**
- 2 players maximum
- Rock (0) beats Scissors (2)
- Paper (1) beats Rock (0)
- Scissors (2) beats Paper (1)
- Tie splits the pot

**Example:**
```bash
# Terminal 1 (Player 1)
> Deploy Contract → APP ID: 1005
> Create Session → SESSION: 0, Fee: 1 ALGO
> Join Game → Rock (0), Save salt: abc123...
> Reveal Move → Rock + abc123...
> Claim Winnings → Check results

# Terminal 2 (Player 2)
> Join Game → APP 1005, SESSION 0
> Choose Paper (1), Save salt: def456...
> Reveal Move → Paper + def456... 
> Claim Winnings → WINS 2 ALGO!
```

---

### 📅 Weekly Lottery

**Multi-player lottery where you pick a day of the week**

**Rules:**
- Unlimited players
- Choose a day: Monday (0) to Sunday (6)
- Prize pool divided across active days
- Each day's pot split among its players
- Least popular day wins the most

**Example:**
```bash
# 6 players join with 1 ALGO each
# Players choose: Mon, Mon, Tue, Tue, Tue, Wed
# Total pot: 6 ALGO

# Distribution:
# - 3 active days → 2 ALGO per day
# - Monday: 2 ALGO / 2 players = 1 ALGO each
# - Tuesday: 2 ALGO / 3 players = 0.66 ALGO each
# - Wednesday: 2 ALGO / 1 player = 2 ALGO (BEST!)
```

---

### 🦌 Stag Hunt

**Cooperation game with risk/reward trade-off**

**Rules:**
- Hare (0): Safe choice, always get 80% refund
- Stag (1): Risky, need 51%+ cooperation to win
- Success: Stags split pot + Global Jackpot
- Failure: Stags lose everything → feeds Jackpot
- Must resolve session before claiming

**Example:**
```bash
# 10 players, 1 ALGO each, Threshold: 51%
# Choices: 6 Stags, 4 Hares

# Cooperation: 60% ≥ 51% → SUCCESS!

# Payouts:
# - Each Hare: 0.8 ALGO refund
# - Each Stag: (6 ALGO - 3.2 ALGO) / 6 = 0.47 ALGO
#   + Share of Global Jackpot!

# If threshold failed:
# - Each Hare: 0.8 ALGO refund
# - Each Stag: 0 ALGO (feeds jackpot)
```

---

### 🎯 Guess 2/3 Average

**Classic game theory experiment**

**Rules:**
- Everyone picks 0-100
- Average is calculated
- Target = 2/3 × Average
- Closest to target wins

**Example:**
```bash
# 5 players choose: 0, 25, 50, 75, 100
# Average: 50
# Target: 2/3 × 50 = 33.33 → 33

# Distances:
# - 0: 33 away
# - 25: 8 away
# - 50: 17 away
# - 75: 42 away
# - 100: 67 away

# Winner: 25 (closest to 33)
```

---

### 🎯 Pirate Game

**Multi-round resource distribution with voting and elimination**

**Rules:**
- 3-20 pirates compete for treasure
- Senior pirate proposes distribution
- All pirates vote (commit-reveal)
- >= 50% YES → Game ends, proposal executed
- < 50% NO → Proposer eliminated, next round
- Timeout system eliminates AFK players

**Phases:**
- Registration: Pirates join and pay entry fee
- Proposal: Current senior proposes distribution
- Vote Commit: Pirates commit vote (YES/NO)
- Vote Reveal: Pirates reveal their vote
- Execute Round: Check majority and proceed
- Finished: Distribution complete

**Example:**
```bash
# 5 pirates, 10 ALGO pot, Pirate #0 proposes:
# P0: 6 ALGO, P1: 1 ALGO, P2: 1 ALGO, P3: 1 ALGO, P4: 1 ALGO

# Voting Results: 3 YES, 2 NO → PASSED!
# Distribution executed, game ends

# If vote FAILED:
# - Pirate #0 eliminated
# - 4 pirates remain, Pirate #1 now proposes
# - Process repeats until majority passes
```

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
    ├── rps.ts           # RockPaperScissors 
    ├── stagHunt.ts      # StagHunt 
    ├── guessGame.ts     # GuessGame 
    ├── weekly.ts        # WeeklyGame
    └── pirateGame.ts    # PirateGame 
```

### Plugin System

Adding a new game is simple:

```typescript
export const MyGameModule: IGameModule = {
  id: 'MYGAME',
  name: '🎲 My Game',
  
getAvailableActions: (): GameAction[] => [
    { name: '🚀 Deploy', value: 'deploy' },
    { name: '🆕 Create', value: 'create', separator: true },
    { name: '👋 Join', value: 'join' },
    { name: '🔓 Reveal', value: 'reveal' },
    { name: '📊 Dashboard', value: 'status', separator: true },
    { name: '💵 Claim', value: 'claim' },
    ...
  ],

   deploy: async (wallet) => { /* deploy logic. It needs to call initialize() 
           await appClient.send.initialize({
                args: { gameType: 'MYGAME' },
                sender: wallet.account.addr,
             });
    */ },
  create: async (wallet) => { /* create logic */ },
  join: async (wallet) => { /* join logic */ },
  reveal: async (wallet) => { /* reveal logic */ },
  status: async (wallet) => { /* status logic */ },
  claim: async (wallet) => { /* claim logic */ }
};

// Register in index.ts
GameRegistry.register(MyGameModule);
```

### Security Features

**Commit-Reveal Pattern:**
```typescript
// Client calculates hash locally
const salt = crypto.randomBytes(32);
const hash = sha256(choice + salt);

// Only hash goes on-chain
await client.joinSession({ commit: hash });

// Later, reveal proves commitment
await client.revealMove({ choice, salt });
```

**MBR Automation:**
- Auto-queries contract for exact costs
- Handles session + player storage
- No manual calculation needed

**Error Handling:**
- Clean, actionable error messages
- No verbose stack traces
- Context-aware tips

---

## 🎨 UI Features

### Color-Coded Status

- 🟢 **Green**: Active/Open phases
- 🟡 **Yellow**: Waiting/Transitioning
- 🔴 **Red**: Closed/Expired
- 🏁 **Finished**: Game completed
- ⚖️ **Needs Action**: Requires resolve/execute

### Smart Prompts

- Validates APP IDs (checks if contract exists)
- Auto-calculates fees from on-chain data
- Shows remaining rounds for each phase
- Warns about expired sessions
- Game-type verification prevents wrong contract usage

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

## 💡 Pro Tips 

### Multi-Terminal Testing

**Test locally with multiple players:**

```bash
# Terminal 1: Player 1 (persistent)
# Use .env with MNEMONIC
npm run cli

# Terminal 2: Player 2 (temporary)
# Delete/rename .env
npm run cli

# Terminal 3: Player 3 (temporary)
npm run cli
```
### Game-Specific Tips

**Rock Paper Scissors:**
- Quick 1v1 matches
- Use timeout claim if opponent doesn't reveal
- Perfect for testing basic commit-reveal

**Weekly Lottery:**
- Think contrarian: pick the least popular day
- Monitor dashboard to see player distribution
- No skill required, pure luck and strategy

**Stag Hunt:**
- Watch Global Jackpot accumulation
- Cooperation threshold usually 51%
- Safe players choose Hare, risk-takers choose Stag
- Must call "Resolve" before claiming

**Guess 2/3 Average:**
- Pure game theory
- Level-0 thinking: 66
- Level-1 thinking: 44
- Level-2 thinking: 29
- Experienced players tend toward 0-10

**Pirate Game:**
- As proposer: give minimum to secure votes
- As voter: calculate if next round is better
- AFK players get eliminated via timeout
- Senior position is powerful but not absolute
- Complex multi-round strategy required

---

## 🤝 Contributing

To add a new game:

1. Create game module in `cli/games/yourGame.ts`
2. Implement `IGameModule` interface
3. Add game-specific logic
4. Register in `cli/index.ts`
5. Update this README with game rules

---