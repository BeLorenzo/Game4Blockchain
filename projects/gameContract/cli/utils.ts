/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import inquirer from 'inquirer';
import chalk from 'chalk';
import { WalletManager } from './walletManager';

/**
 * UTILS
 * Shared helper functions for all game modules.
 */

/**
 * Prompts the user for an App ID or reads it from .env.
 * It also validates if the App actually exists on the chain.
 */
export async function getAppId(wallet: WalletManager): Promise<bigint> {
  let appId: bigint | undefined;

  if (!appId) {
    const answer = await inquirer.prompt([{
      type: 'input',
      name: 'manualAppId',
      message: 'Enter Contract APP ID (ask the Creator):',
      validate: async (input) => {
        if (isNaN(parseInt(input))) return 'Invalid Number';
        try {
          // Live validation: Check if app exists
          await wallet.algorand.client.algod.getApplicationByID(parseInt(input)).do();
          return true; 
        } catch (e) {
          return `❌ App ID ${input} does not exist on this network.`;
        }
      }
    }]);
    appId = BigInt(answer.manualAppId);
  } else {
    // Validate the .env ID silently
    try {
      await wallet.algorand.client.algod.getApplicationByID(Number(appId)).do();
    } catch (e) {
      console.log(chalk.red(`❌ The App ID ${appId} in .env is invalid.`));
      throw new Error("Invalid App ID in .env");
    }
  }

  return appId;
}

/**
 * Fetches the current round from the blockchain.
 */
export async function getCurrentRound(wallet: WalletManager): Promise<bigint> {
  const status = await wallet.algorand.client.algod.status().do();
  // Handle SDK compatibility (camelCase vs kebab-case)
  return BigInt(status['lastRound'] ?? status['lastRound']);
}

/**
 * Formats a visual difference between rounds (e.g. "5 rounds left").
 */
export function getRoundDiff(current: bigint, target: bigint): string {
  const diff = target - current;
  if (diff > 0) return chalk.green(`(${diff} rounds left)`);
  if (diff === 0n) return chalk.yellow(`(ENDING NOW)`);
  return chalk.red(`(Ended ${-diff} rounds ago)`);
}

/**
 * Centralized Error Handler.
 * Parses raw Algorand errors into human-readable messages.
 */
export function handleAlgoError(e: any, context: string) {
  const msg = e.message || JSON.stringify(e);

  console.log(chalk.red(`\n❌ Error during ${context}:`));

  if (msg.includes('overspend')) {
    console.log(chalk.yellow('   -> Insufficient funds in wallet. You need more ALGOs.'));
  } else if (msg.includes('logic eval')) {
    console.log(chalk.yellow('   -> Smart Contract Logic Failed.'));
    console.log(chalk.gray('      (e.g., Wrong Phase, Wrong Bet Amount, Hash Mismatch)'));
  } else if (msg.includes('box not found') || msg.includes('404')) {
    console.log(chalk.yellow('   -> Session Data not found. Check your Session ID.'));
  } else if (msg.includes('signer')) {
    console.log(chalk.yellow('   -> Signer Error. Wallet not configured correctly.'));
  }else if (msg.includes('Commit phase')) {
    console.log(chalk.yellow('   -> Temporal error. Commit phase not over yet')); 
  } else if (msg.includes('Reveal phase')) {
    console.log(chalk.yellow('   -> Temporal error. Reveal phase is over')); 
  } else if (msg.includes('already')) {
    console.log(chalk.yellow('   -> Double play is not permitted')); 
  }
  else {
    console.log(chalk.gray(msg));
  }
}
