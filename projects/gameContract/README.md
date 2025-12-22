# Algorand Commit-Reveal Core

A TypeScript architectural framework for Algorand implementing the Commit-Reveal pattern. Provides a secure abstract contract for building anti-frontrunning on-chain games.

## 🛡️ Why Commit-Reveal?

On public blockchains, the Mempool is transparent. If a game broadcasts moves in clear text (e.g., "Rock"), an adversary or bot can observe the pending transaction and send a winning counter-move (e.g., "Paper"). This makes strategy games impossible.

**The Framework Solution** natively implements the Commit-Reveal schema to ensure fairness:

- **Commit Phase**: Players send only the Hash of their move (SHA256(choice + salt)). The information is on-chain, but secret.
- **Reveal Phase**: Only after the commit phase is closed, players reveal the move and salt. The contract mathematically verifies they match the original hash.

## 🏗️ Architecture Design

The architecture follows a rigorous Object-Oriented pattern to maximize security and code reuse.

### Abstract GameContract (The Parent)

Handles low-level infrastructure complexity:

- **State Management**: Base Algorand Box management and precise MBR calculation
- **Security**: Cryptographic hash verification and anti-replay protection
- **Timeline**: Block round control for phase opening and closing

### Concrete Contracts (The Children)

Inherit from the parent and focus only on game logic:

- **RockPaperScissors**: 2-player game with instant winner determination and timeout victory
- **WeeklyGame**: Multi-player lottery where players choose days of the week (minority game)
- **StagHunt**: Cooperation game with threshold mechanics and global jackpot accumulation
- **GuessGame**: Classic "Guess 2/3 of the Average" - game theory with Nash equilibrium

```mermaid
classDiagram
    class GameContract {
        <>
        +create() uint64
        +join() void
        +reveal() void
        +getRequiredMBR() uint64
        #getPlayerKey() bytes
        #getSessionBalance() uint64
    }

    class RockPaperScissors {
        - 2 players
        - Instant payout
        - Rock/Paper/Scissors
        - Timeout victory
    }

    class WeeklyGame {
        - N players
        - 7 days lottery
        - Pull-based claims
        - Minority game
    }

    class StagHunt {
        - Cooperation threshold
        - Global jackpot
        - Dynamic admin rules
        - Hare safety net
    }

    class GuessGame {
        - Guess 2/3 average
        - Nash equilibrium
        - Strategic depth
        - Frequency tracking
    }

    class YourCustomGame {
        - Your rules here
        - Your logic here
    }

    GameContract <|-- RockPaperScissors
    GameContract <|-- WeeklyGame
    GameContract <|-- StagHunt
    GameContract <|-- GuessGame
    GameContract <|-- YourCustomGame

    note for GameContract "Core Framework\nCommit-Reveal Security\nTimeline Management\nMBR Handling"
```

## 📁 Project Structure

```
smart_contracts/
    ├── index.ts                      # Deploy orchestrator (entry point)
    ├── abstract_contract/
    │   └── contract.algo.ts          # Abstract Smart Contract Logic
    ├── RockPaperScissors/
    │   ├── contract.algo.ts          # Smart Contract
    │   ├── deploy-config.ts          # Configuration
    │   └── contract.e2e.spec.ts      # Tests
    ├── weeklyGame/
    │   ├── contract.algo.ts
    │   ├── deploy-config.ts
    │   └── contract.e2e.spec.ts
    ├── stagHunt/
    │   ├── contract.algo.ts
    │   ├── deploy-config.ts
    │   └── contract.e2e.spec.ts
    ├── guessGame/
    │   ├── contract.algo.ts
    │   ├── deploy-config.ts
    │   └── contract.e2e.spec.ts
    └── artifacts/                    # Auto-generated during compilation
```
## 💻 Development Commands

Since prerequisites are handled in the root README, here are the specific commands for developing within this folder:

## Running Tests

To ensure logic integrity:

```bash
npm test                              # All tests
npm test -- stagHunt                  # Specific game
```

## Compiling Atrifacts

If you modify the contracts, regenerate the TEAL and Clients:

```bash
npm run build
```

**Note**: The artifacts/ folder is automatically generated and contains TEAL files and typed TypeScript clients for interacting with contracts.

## 💻 Usage Examples

To ensure security (Anti-Frontrunning), the client does NOT send the move in clear text. It must calculate the hash locally and send only that.

### Phase 1: Commit

```typescript
import { sha256 } from 'js-sha256';
import { algosdk } from 'algosdk';

// 1. User chooses move (e.g., 0 = Rock)
const myChoice = 0;

// 2. Generate a secret "Salt"
// IMPORTANT: The client must save this value, it will be needed for reveal!
const mySalt = new Uint8Array(32);
crypto.getRandomValues(mySalt);

// 3. Create payload
const choiceBytes = algosdk.encodeUint64(myChoice);
const dataToHash = new Uint8Array([...choiceBytes, ...mySalt]);

// 4. Calculate SHA256 Hash
const commitHash = sha256.array(dataToHash);

// 5. Send ONLY the hash to blockchain
await appClient.joinSession({
  sessionID: 123,
  commit: commitHash,
  payment: algosdk.makePaymentTxnWithSuggestedParamsFromObject({ ... })
});
```

### Phase 2: Reveal

```typescript
// When commit phase is closed, send clear data for verification
await appClient.revealMove({
  sessionID: 123,
  choice: myChoice, // 0
  salt: mySalt, // The salt generated earlier
})
```

## 🎮 Implemented Games

### 🪨 RockPaperScissors

Classic 2-player game with instant winner determination.

**Features:**
- 2-player maximum per session
- Instant prize distribution after both reveals
- Three outcomes: win/lose/tie
- Timeout victory mechanism

**Game Flow:**
1. Two players commit (Rock=0, Paper=1, Scissors=2)
2. After commit deadline, both reveal
3. Contract determines winner immediately
4. Winner receives full pot (or 50/50 split on tie)
5. Timeout victory available if opponent doesn't reveal

### 📅 WeeklyGame

Multi-player lottery where players choose days of the week.

**Features:**
- Unlimited players per session
- Prize pool distributed across active days
- Pull-based prize claiming
- Minority game mechanics

**Strategy:** Fewer competitors on your day = bigger share

**Example:**
```
7 players, 70 ALGO pot
- Monday: 3 players
- Tuesday: 2 players  
- Wednesday: 2 players

3 active days → 23.33 ALGO per day
Tuesday players: 23.33 / 2 = 11.66 ALGO each (BEST!)
```

### 🦌 StagHunt

Cooperation game with threshold mechanics inspired by game theory's assurance game.

**Features:**
- Dynamic cooperation threshold (default 51%)
- Global jackpot accumulation
- Safety net for risk-averse players
- Admin-configurable rules

**Two Choices:**

1. **HARE (0)**: Safe choice
   - Always get 80% refund
   - Guaranteed small loss: -20% ALGO

2. **STAG (1)**: Risky cooperation
   - Need threshold % of players to also choose Stag
   - If threshold MET: Split pot + jackpot (BIG WIN)
   - If threshold MISSED: Lose everything

**Example:**
```
4 players, 40 ALGO pot, threshold 51%
Choices: 3 Stags, 1 Hare

Cooperation: 75% ≥ 51% → SUCCESS!

Payouts:
- Hare: 8 ALGO refund
- Each Stag: ~10.66 ALGO + jackpot share
```

### 🎯 GuessGame

"Guess 2/3 of the Average" - classic game theory experiment.

**Mechanics:**
1. Players choose a number (0-100)
2. Average calculated
3. Target = 2/3 × Average
4. Closest to target wins

**Strategy:**
- **Nash Equilibrium**: 0
- **Reality**: Most play 15-40 range
- Game theory depth testing

**Example:**
```
Players: [0, 33, 50, 67, 100]
Average: 50
Target: 33

Winner: Player who chose 33
```

## 🛠️ Extending the Framework

### Creating a New Game

```typescript
import { GameContract, GameConfig } from './abstract_contract/contract.algo';

export class YourGame extends GameContract {
  // 1. Add your game-specific BoxMaps
  customData = BoxMap<uint64, YourDataType>({ keyPrefix: 'cus' });
  
  // 2. Override createSession for additional MBR/storage
  public createSession(config: GameConfig, mbrPayment: gtxn.PaymentTxn): uint64 {
    const sessionID = super.create(config);
    // Initialize your custom data
    return sessionID;
  }
  
  // 3. Implement game-specific logic
  public determineWinner(sessionID: uint64): void {
    // Your custom game logic here
  }
  
  // 4. Calculate additional MBR requirements
  public getRequiredMBR(command: 'newGame' | 'join'): uint64 {
    const customMBR = this.getBoxMBR(10, 32); // Your boxes
    return customMBR + super.getRequiredMBR(command);
  }
}
```
## 🔒 Security Features

- **Anti-Frontrunning**: Commit-Reveal pattern prevents move prediction
- **Anti-Replay**: Player data cleanup after prize distribution
- **Timeline Enforcement**: Strict phase-based access control
- **MBR Management**: Precise storage cost calculation and handling
- **Hash Verification**: SHA256 integrity
- **Timeout Protection**: Anti-griefing
