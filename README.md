# Game4Blockchain 🎮

> **🚧 Project in Active Development**

A secure blockchain gaming framework built on Algorand featuring anti-frontrunning games using commit-reveal pattern.

[![Language](https://img.shields.io/badge/language-TypeScript-blue)](https://www.typescriptlang.org/)
[![Framework](https://img.shields.io/badge/framework-AlgoKit-black)](https://github.com/algorandfoundation/algokit-cli)
[![Platform](https://img.shields.io/badge/platform-Algorand-green)](https://algorand.com)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

## ⚙️ Prerequisites

Before running the project, ensure you have the following installed globally:

- **Node.js v22+**: Required to run the TypeScript environment.
- **Docker Desktop**: Essential. Must be installed and **running** to start LocalNet.
- **AlgoKit CLI**: The tool for managing the project lifecycle.

## 🚀 Quick Start & Installation

To deploy the contracts locally, follow these steps:

```bash
# 1. Clone the repository
git clone [https://gitlab.com/Horus189/games4blockchain.git](https://gitlab.com/Horus189/games4blockchain.git)
cd games4blockchain

# 2. Navigate to the contracts project
cd projects/smart_contracts

# 3. Install dependencies
npm install

# 4. Start Local Blockchain
# IMPORTANT: Make sure Docker Desktop is open and running!
algokit localnet start

# 5. Compile & Deploy
npm run build
npm run deploy
```


## 📚 Documentation

**👉 [View Smart Contract Framework Documentation](./projects/gameContract/README.md)**

The core framework is currently implemented and tested at the smart contract level. Frontend implementation is planned for future development.

## 🏗️ Project Structure

```
game4blockchain/
├── projects/
│ ├── contracts/  ✅ Ready - Smart contracts & framework
│ └── frontend/   🚧 Planned - Frontend
└── README.md     <- You are here
```
## 🎯 What's Available Now

- ✅ **Secure Commit-Reveal Framework**
- ✅ **RockPaperScissors Implementation**
- ✅ **WeeklyGame Implementation**
- ✅ **Comprehensive Test Suite**
- ✅ **TypeScript Clients**

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

---

*Frontend implementation coming soon. Currently focused on robust smart contract foundation.*
