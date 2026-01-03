/* eslint-disable @typescript-eslint/no-explicit-any */
import chalk from 'chalk';
import inquirer from 'inquirer';
import { GameRegistry } from './gameRegistry';
import { IGameModule } from './interfaces';

export const UI = {
  clear: () => {
    console.clear();
  },

  printTitle: (text: string) => {
    console.log(chalk.bgBlue.white.bold(`  ${text}  `));
    console.log(''); 
  },

  separator: () => {
    console.log(chalk.gray('------------------------------------------------'));
  },

  selectGameType: async () => {
    const games = GameRegistry.getAll();

    const choices: any[] = games.map((g) => ({
      name: g.name, 
      value: g.id,  
    }));

    choices.push(new inquirer.Separator());
    choices.push({ name: '❌ Exit CLI', value: 'exit' }); 

    const answer = await inquirer.prompt([
      {
        type: 'list', 
        name: 'gameId',
        message: 'What do you want to play today?',
        choices: choices,
      },
    ]);

    return answer.gameId;
  },

  /**
   * Dynamic action menu - builds menu from game's available actions
   */
  mainMenu: async (gameModule: IGameModule) => {
    console.log(chalk.cyan(`\n🎮 ${gameModule.name} - Actions`));
    
    const actions = gameModule.getAvailableActions();
    
    // Build choices with separators
    const choices: any[] = [];
    
    for (const action of actions) {
      if (action.separator) {
        choices.push(new inquirer.Separator());
      }
      choices.push({
        name: action.name,
        value: action.value
      });
    }
    
    // Always add back option at the end
    choices.push(new inquirer.Separator());
    choices.push({ name: '🔙 Back to Game Selection', value: 'back' });

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What do you want to do?',
        choices: choices,
      },
    ]);
    
    return answer.action;
  },
};
