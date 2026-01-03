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

async function main() {
  UI.clear();
  UI.printTitle('ALGO GAME CLI FRAMEWORK');

  const walletMgr = new WalletManager();
  const account = await walletMgr.initWallet();

  if (!account) {
    console.log(chalk.red('❌ Critical Error: Could not initialize wallet.'));    
    process.exit(1);
  }

  // Register Games
  GameRegistry.register(RPSGameModule);
  GameRegistry.register(WeeklyGameModule);
  GameRegistry.register(StagHuntModule);
  GameRegistry.register(GuessGameModule);
  GameRegistry.register(PirateGameModule);

  while (true) {
    UI.separator();

    // STEP A: Select Game
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

    // STEP B: Select Action (dynamic menu)
    const action = await UI.mainMenu(gameModule);

    if (action === 'back') continue;

    // STEP C: Execute action dynamically
    try {
      console.log(chalk.gray(`\n--- Executing ${action.toUpperCase()} ---`));
      
      // Call the method dynamically
      if (typeof gameModule[action] === 'function') {
        await gameModule[action](walletMgr);
      } else {
        console.log(chalk.red(`❌ Action "${action}" not implemented in ${gameModule.name}`));
      }
    } catch (error: any) {
        console.log(chalk.red(`\n💥 Fatal Error:`), error.message);      
    }
    console.log('\n');
  }
}

main();
