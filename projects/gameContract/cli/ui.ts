/* eslint-disable @typescript-eslint/no-explicit-any */
import chalk from 'chalk';
import inquirer from 'inquirer';
import { GameRegistry } from './gameRegistry';

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

  mainMenu: async () => {
    console.log(chalk.cyan(`\n🎮 Operations Menu`));
    
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What do you want to do?',
        choices: [
          { name: '🚀 Deploy New Contract', value: 'deploy' }, 
          new inquirer.Separator(),
          { name: '🆕 Create New Game Session', value: 'create' },
          { name: '👋 Join Existing Game', value: 'join' },
          { name: '🔓 Reveal Move', value: 'reveal' }, 
          { name: '👀 Check Status (Dashboard)', value: 'status' },
          new inquirer.Separator(),
          { name: '🔙 Back to Game Selection', value: 'back' },
        ],
      },
    ]);
    return answer.action;
  },
};
