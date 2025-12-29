/* eslint-disable @typescript-eslint/no-explicit-any */
import { WalletManager } from './walletManager';
import { GameRegistry } from './gameRegistry';
import { RPSGameModule } from './games/rps'; 
import { WeeklyGameModule } from './games/weekly';
import { StagHuntModule } from './games/stagHunt';
import { GuessGameModule } from './games/guessGame';
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

    // STEP B: Select Action
    const action = await UI.mainMenu();

    if (action === 'back') continue;

    // STEP C: Execute
    try {
      console.log(chalk.gray(`\n--- Executing ${action.toUpperCase()} ---`));      
      switch (action) {
        case 'deploy': 
          await gameModule.deploy(walletMgr);
          break;
        case 'create':
          await gameModule.create(walletMgr);
          break;
        case 'join':
          await gameModule.join(walletMgr);
          break;
        case 'reveal':
          await gameModule.reveal(walletMgr);
          break;
        case 'status':
          await gameModule.getStatus(walletMgr);
          break;
        default:
          console.log(chalk.red('Unknown action.'));
      }
    } catch (error: any) {
        console.log(chalk.red(`\n💥 Fatal Error:`), error.message);      
    }
    console.log('\n');
  }
}

main();
