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

- **RockPaperScissors**: Implements 2-player winning logic and instant payment
- **WeeklyGame**: Extends logic for N-players and handles lottery-style prize pool accumulation

```mermaid
classDiagram
    class GameContract {
        <<Abstract>>
    }

    class ConcreteGame {
        <<Interface>>
    }

    class RockPaperScissors {
        - 2 players
        - Instant payout
        - Rock/Paper/Scissors
    }

    class WeeklyGame {
        - 7 days lottery
        - Multiple players
        - Pull-based claims
    }

    class YourCustomGame {
        - Your rules here
        - Your logic here
    }

    GameContract <|-- ConcreteGame
    ConcreteGame <|-- RockPaperScissors
    ConcreteGame <|-- WeeklyGame
    ConcreteGame <|-- YourCustomGame

    note for GameContract "Core Framework\nCommit-Reveal Security\nTimeline Management\nMBR Handling"
    note for ConcreteGame "Implement your game logic\nExtend with custom data structures\nOverride prize distribution"
```

## 📁 Project Structure

```
smart_contracts/
    ├── index.ts           # Deploy Orchestrator (entry point)
    ├── abstract_contract/
    │   └── contract.algo.ts       # Abstract Smart Contract Logic
    ├── RockPaperScissors/
    │   ├── contract.algo.ts       # Smart Contract Logic
    │   ├── deploy-config.ts       # Configuration
    │   └── contract.spec.ts       # Tests
    ├── weeklyGame/
    │   ├── contract.algo.ts       # Smart Contract Logic
    │   ├── deploy-config.ts       # Configuration
    │   └── contract.spec.ts       # Tests
    └── artifacts/             # Auto-generated during compilation
```
## 💻 Development Commands

Since prerequisites are handled in the root README, here are the specific commands for developing within this folder:

## Running Tests

To ensure logic integrity:

```bash
npm test
```

## Compiling Atrifacts

If you modify the contracts, regenerate the TEAL and Clients:

```bash
npm run build
```

**Note**: The artifacts/ folder is automatically generated.
> It contains TEAL files and typed TypeScript clients for interacting with contracts.

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

## 🎮 Example implementation

### 🪨 RockPaperScissors

Classic 2-player game with instant winner determination and prize distribution.

**Features:**

- 2-player maximum per session
- Instant prize distribution after both reveals
- Three possible outcomes: win/lose/tie

### 📅 WeeklyGame

Multi-player lottery-style game where players choose days of the week.

**Features:**

- Unlimited players per session
- Prize pool distributed across active days
- Pull-based prize claiming system

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
