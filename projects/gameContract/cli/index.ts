/* eslint-disable @typescript-eslint/no-explicit-any */
import { WalletManager } from './walletManager';
import { GameRegistry } from './gameRegistry';
import { RPSGameModule } from './games/rps';
import { WeeklyGameModule } from './games/weekly';
import { StagHuntModule } from './games/stagHunt';
import { GuessGameModule } from './games/guessGame';
import { PirateGameModule } from './games/pirateGame';
import { UI } from './ui';
import chalk from 'chalk';

/**
 * Main Entry Point for the Algo Game CLI Framework.
 * * Workflow:
 * 1. Initializes the CLI UI.
 * 2. Sets up the User Wallet (Environment or Temporary).
 * 3. Registers all available Game Modules.
 * 4. Enters the Main Event Loop (Game Selection -> Action Execution).
 */
async function main() {
  UI.clear();
  UI.printTitle('ALGO GAME CLI FRAMEWORK');

  const walletMgr = new WalletManager();
  const account = await walletMgr.initWallet();

  if (!account) {
    console.log(chalk.red('❌ Critical Error: Could not initialize wallet.'));
    process.exit(1);
  }

  // === Register Games ===
  GameRegistry.register(RPSGameModule);
  GameRegistry.register(WeeklyGameModule);
  GameRegistry.register(StagHuntModule);
  GameRegistry.register(GuessGameModule);
  GameRegistry.register(PirateGameModule);

  // === Main Application Loop ===
  while (true) {
    UI.separator();

    // 1. Select Game Type
    const gameId = await UI.selectGameType();

    if (gameId === 'exit') {
      console.log(chalk.yellow('👋 Goodbye!'));
      process.exit(0);
    }

    const gameModule = GameRegistry.get(gameId);
    if (!gameModule) {
      console.log(chalk.red('❌ Error: Game module not found.'));
      continue;
    }

    // 2. Game Session Loop (Specific Game Actions)
    while (true) {
      // Display the flattened menu with all available actions for the module
      const action = await UI.mainMenu(gameModule);

      if (action === 'back') break; // Return to Game Selection

      try {
        console.log(chalk.gray(`\n--- Executing ${action.toUpperCase()} ---`));

        // Dynamically execute the chosen method on the game module
        if (typeof (gameModule as any)[action] === 'function') {
          await (gameModule as any)[action](walletMgr);
        } else {
          console.log(chalk.red(`❌ Action "${action}" not implemented in ${gameModule.name}`));
        }
      } catch (error: any) {
        console.log(chalk.red(`\n💥 Fatal Error:`), error.message);
      }

      // Visual spacer before re-printing the menu
      console.log('\n');
    }
  }
}

main();
