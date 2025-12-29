/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import inquirer from 'inquirer';
import chalk from 'chalk';
import { WalletManager } from './walletManager';

/**
 * Validates that the contract at appId matches the expected game type.
 * Reads gameType from global state and compares.
 */
export async function validateContractType(
  wallet: WalletManager,
  appId: bigint,
  expectedType: string
): Promise<boolean> {
  try {
    const appInfo = await wallet.algorand.client.algod.getApplicationByID(Number(appId)).do();
    const globalState = appInfo.params['globalState'] || [];
    
    // Find gameType in global state
    const gameTypeEntry = globalState.find(item => 
      Buffer.from(item.key).toString('utf8') === 'gameType'
    );
    
    // If gameType is missing, something went wrong during deploy
    if (!gameTypeEntry) {
      console.log(chalk.red('\n❌ CONTRACT NOT INITIALIZED!'));
      console.log(chalk.yellow('   This contract was deployed without calling initialize().'));
      console.log(chalk.yellow('   The deploy process should automatically call initialize().'));
      console.log(chalk.yellow('   Please re-deploy the contract or manually call initialize().\n'));
      return false;
    }
    
    // Decode gameType value 
    const actualType = Buffer.from(gameTypeEntry.value.bytes).toString('utf8');
    
    if (actualType !== expectedType) {
      console.log(chalk.red('\n❌ WRONG CONTRACT TYPE!'));
      console.log(chalk.red(`   Expected: ${chalk.bold(expectedType)}`));
      console.log(chalk.red(`   Found: ${chalk.bold(actualType)}`));
      console.log(chalk.yellow('   Please check your APP ID.\n'));
      return false;
    }
    
    console.log(chalk.green(`✅ Confirmed: ${chalk.bold(actualType)} contract\n`));
    return true;
    
  } catch (error) {
    console.log(chalk.red('❌ Error validating contract type:', error));
    return false;
  }
}

/**
 * Prompts the user for an App ID and validates it exists and has correct type.
 * 
 * @param wallet - The wallet manager instance
 * @param expectedType - The expected game type (e.g., 'RPS', 'STAGHUNT')
 * @returns The validated App ID
 */
export async function getAppId(wallet: WalletManager, expectedType: string): Promise<bigint> {
  const answer = await inquirer.prompt([{
    type: 'input',
    name: 'manualAppId',
    message: 'Enter Contract APP ID:',
    validate: async (input) => {
      if (isNaN(parseInt(input))) return 'Invalid Number';
      
      try {
        // Check if app exists
        await wallet.algorand.client.algod.getApplicationByID(parseInt(input)).do();
        return true;
      } catch (e) {
        return `❌ App ID ${input} does not exist on this network.`;
      }
    }
  }]);
  
  const appId = BigInt(answer.manualAppId);
  
  // Validate contract type
  const isValid = await validateContractType(wallet, appId, expectedType);
  if (!isValid) {
    console.log(chalk.yellow('Exiting... Please use the correct APP ID for this game.\n'));
    process.exit(1);
  }
  
  return appId;
}

/**
 * Fetches the current round from the blockchain.
 */
export async function getCurrentRound(wallet: WalletManager): Promise<bigint> {
  const status = await wallet.algorand.client.algod.status().do();
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
 * Error Handler.
 * Just extracts the clean message and shows it.
 */
export function handleAlgoError(e: any, context: string) {
  // Get error message
  const msg = e.message || String(e);
  
  // Try to extract just the assert message (most common case)
  const match = msg.match(/assert failed[^:]*:\s*(.+?)(?:\n|$)/i);
  const cleanMsg = match ? match[1].trim() : msg.split('\n')[0];
  
  // Show it
  console.log(chalk.red(`\n❌ ${context} failed:`));
  console.log(chalk.yellow(`   ${cleanMsg}\n`));
}
