/* eslint-disable @typescript-eslint/no-explicit-any */
import chalk from 'chalk';
import inquirer from 'inquirer';
import { GameRegistry } from './gameRegistry';
import { IGameModule } from './interfaces';

export const UI = {
  /**
   * Clears the console screen.
   */
  clear: () => {
    console.clear();
  },

  /**
   * Prints a styled blue banner with the provided text.
   */
  printTitle: (text: string) => {
    console.log(chalk.bgBlue.white.bold(`  ${text}  `));
    console.log('');
  },

  /**
   * Prints a gray separator line to the console.
   */
  separator: () => {
    console.log(chalk.gray('------------------------------------------------'));
  },

  /**
   * Prompts the user to select a game from the GameRegistry.
   */
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
        pageSize: 15,
      },
    ]);

    return answer.gameId;
  },

  /**
   * Displays the main menu for a specific game module.
   * Dynamically builds the list based on the module's available actions.
   */
  mainMenu: async (gameModule: IGameModule) => {
    console.log(chalk.cyan(`\n🎮 ${gameModule.name} - Actions`));

    const actions = gameModule.getAvailableActions();

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

    choices.push(new inquirer.Separator());
    choices.push({ name: '🔙 Back to Game Selection', value: 'back' });

    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What do you want to do?',
        choices: choices,
        pageSize: 20,
        loop: false
      },
    ]);

    return answer.action;
  },
};
