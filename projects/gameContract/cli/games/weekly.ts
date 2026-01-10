/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { IGameModule, GameAction } from '../interfaces';
import { WalletManager } from '../walletManager';
import { getAppId, getCurrentRound, getRoundDiff, handleAlgoError } from '../utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import chalk from 'chalk';
import inquirer from 'inquirer';
import algosdk from 'algosdk';
import { sha256 } from 'js-sha256';

import { 
  WeeklyGameClient, 
  WeeklyGameFactory 
} from '../../smart_contracts/artifacts/weeklyGame/WeeklyGameClient';
import { UI } from '../ui';

/**
 * Helper to initialize the Algokit Application Client.
 */
const getClient = async (wallet: WalletManager) => {
  const appId = await getAppId(wallet, 'WEEKLY');
  return new WeeklyGameClient({
    algorand: wallet.algorand,
    appId,
    defaultSender: wallet.account!.addr,
  });
};

/**
 * Helper to prompt the user for a Session ID.
 */
const askSessionId = async () => {
  const answers = await inquirer.prompt([{
    type: 'input', 
    name: 'sessId', 
    message: 'Enter SESSION ID:',
    validate: (i) => !isNaN(parseInt(i)) || 'Invalid Number',
  }]);
  return BigInt(answers.sessId);
};

export const WeeklyGameModule: IGameModule = {
  id: 'WEEKLY',
  name: '📅 Weekly Lottery',

  getAvailableActions: (): GameAction[] => [
    { name: '🚀 Deploy New Contract', value: 'deploy' },
    { name: '🆕 Create New Game Session', value: 'create', separator: true },
    { name: '🎟️  Buy Ticket (Join)', value: 'join' },
    { name: '🔓 Reveal Day', value: 'reveal' },
    { name: '📊 Dashboard', value: 'status', separator: true },
    { name: '💵 Claim Winnings', value: 'claim' },
  ],

  /**
   * Deploys the Weekly Game Factory contract and initializes it.
   * Funds the contract with 1 ALGO to cover basic MBR.
   */
  deploy: async (wallet: WalletManager) => {
    console.log(chalk.yellow('🚀 Starting Deployment...'));    
    if (!wallet.account) return;

    try {
      const uniqueAppName = `WeeklyGame_${Date.now()}`;
      const factory = wallet.algorand.client.getTypedAppFactory(WeeklyGameFactory, {
        defaultSender: wallet.account.addr,
        appName: uniqueAppName, 
      });

      const { appClient, result } = await factory.deploy({
        onUpdate: 'append', 
        onSchemaBreak: 'append',
        suppressLog: true,
      });

      if (['create', 'replace'].includes(result.operationPerformed)) {
        console.log(chalk.yellow('📝 Initializing contract...'));
        await appClient.send.initialize({ args: { gameType: 'WEEKLY' }, sender: wallet.account.addr });
        console.log(chalk.green('✅ Contract type: WEEKLY'));

        // Fund contract for box storage MBR
        await wallet.algorand.send.payment({
          amount: AlgoAmount.Algos(1),
          sender: wallet.account.addr,
          receiver: appClient.appAddress,
        });
      }

      console.log(chalk.green(`\n✅ DEPLOYMENT SUCCESSFUL!`));
      console.log(chalk.bgGreen.black(` APP ID: ${appClient.appId} `));
    } catch (e: any) { handleAlgoError(e, 'Deploy'); }
  },

  /**
   * Creates a new session.
   * Calculates the MBR required for the 7 counters (Mon-Sun) and funds it.
   */
  create: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const answers = await inquirer.prompt([
        { type: 'input', name: 'participation', message: 'Ticket Price (MicroAlgo)?', default: '1000000' },
        { type: 'input', name: 'startDelay', message: 'Start delay (rounds)?', default: '1' },
        { type: 'input', name: 'duration', message: 'Commit duration (rounds)?', default: '50' },
        { type: 'input', name: 'reveal', message: 'Reveal duration (rounds)?', default: '50' },
      ]);

      const currentRound = await getCurrentRound(wallet);
      const startAt = currentRound + 1n + BigInt(answers.startDelay);
      const endCommitAt = startAt + BigInt(answers.duration);
      const endRevealAt = endCommitAt + BigInt(answers.reveal); 
      const participation = BigInt(answers.participation);

      console.log(chalk.yellow('⏳ Calculating MBR (includes 7 day-counters)...'));
      
      // Calculate MBR specifically for "newGame" command which includes the specific Weekly Game storage requirements
      const mbrResult = await client.send.getRequiredMbr({ args: { command: 'newGame' }, suppressLog: true });
      const requiredMBR = mbrResult.return;

      const mbrPaymentTxn = await wallet.algorand.createTransaction.payment({
        sender: wallet.account!.addr,
        receiver: client.appAddress,
        amount: AlgoAmount.MicroAlgos(Number(requiredMBR)),
      });
      
      const result = await client.send.createSession({
        args: {
          config: { startAt, endCommitAt, endRevealAt, participation },
          mbrPayment: mbrPaymentTxn,
        },
        suppressLog: true,
      });

      console.log(chalk.green(`✅ Session Created!`));
      console.log(chalk.bgGreen.black(` 👉 SESSION ID: ${result.return} `));
    } catch (e: any) { handleAlgoError(e, 'Create Session'); }
  },

  /**
   * Allows a player to buy a ticket by picking a day of the week.
   * Uses a Commit-Reveal scheme: The choice is hashed with a secret salt locally,
   * and only the hash is sent to the chain.
   */
  join: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();

      console.log(chalk.gray('🔎 Reading Session Config...'));
      const sessionConfig = await client.state.box.gameSessions.value(sessionID);
      if (!sessionConfig) throw new Error('Session not found');

      console.log(chalk.cyan(`💰 Ticket Price: ${sessionConfig.participation} µAlgo`));

      const { day } = await inquirer.prompt([{
        type: 'list', name: 'day', message: 'Choose your lucky day:', 
        choices: [
            {name: 'Monday', value: 0}, {name: 'Tuesday', value: 1}, {name: 'Wednesday', value: 2},
            {name: 'Thursday', value: 3}, {name: 'Friday', value: 4}, {name: 'Saturday', value: 5}, {name: 'Sunday', value: 6}
        ]
      }]);

      

      // Generate a cryptographic salt to hide the choice
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      console.log(chalk.bgRed.white(` ⚠️  SECRET SALT: ${Buffer.from(salt).toString('hex')} (SAVE IT!) `));

      // Hash(Day + Salt)
      const choiceBytes = algosdk.encodeUint64(day);
      const combined = new Uint8Array([...choiceBytes, ...salt]);
      const hash = new Uint8Array(sha256.array(combined));

      console.log(chalk.yellow('🎟️ Buying Ticket...'));
      await client.send.joinSession({
        args: {
          sessionId: sessionID,
          commit: hash,
          payment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(sessionConfig.participation)),
          }),
        },
        suppressLog: true,
      });

      console.log(chalk.green('✅ Ticket Purchased!'));
    } catch (e: any) { handleAlgoError(e, 'Join Session'); }
  },

  /**
   * Reveals the player's choice. 
   * The user must provide the original Day and the Secret Salt.
   * The contract verifies: Hash(ProvidedDay + ProvidedSalt) === StoredCommit.
   */
  reveal: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const answers = await inquirer.prompt([
        { type: 'input', name: 'sessId', message: 'Enter SESSION ID:', validate: i => !isNaN(parseInt(i)) || 'Invalid' },
        { 
            type: 'list', name: 'day', message: 'Your original day:', 
            choices: [
                {name: 'Mon', value: 0}, {name: 'Tue', value: 1}, {name: 'Wed', value: 2},
                {name: 'Thu', value: 3}, {name: 'Fri', value: 4}, {name: 'Sat', value: 5}, {name: 'Sun', value: 6}
            ]
        },
        { type: 'input', name: 'salt', message: 'Paste SECRET SALT (Hex):' },
      ]);

      const sessionId = BigInt(answers.sessId);
      const choice = BigInt(answers.day);
      const salt = new Uint8Array(Buffer.from(answers.salt.replace('0x', ''), 'hex'));

      console.log(chalk.yellow(`🔓 Revealing...`));
      await client.send.revealMove({
        args: { sessionId, choice, salt },
        suppressLog: true,
      });

      console.log(chalk.green('✅ Day Revealed!'));
      console.log(chalk.blue('ℹ️  If yours is the least picked day, you might win!'));
    } catch (e: any) { handleAlgoError(e, 'Reveal'); }
  },

  /**
   * Displays a dashboard of the last 5 sessions and their current states.
   */
  status: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const currentRound = await getCurrentRound(wallet);
      const totalSessions = Number((await client.state.global.getAll()).sessionIdCounter!);

      UI.printTitle('📊 DASHBOARD WEEKLY LOTTERY');
      console.log(chalk.white(`🌍 Current Round: ${chalk.bold(currentRound)}`));
      UI.separator();

      if (totalSessions === 0) {
        console.log(chalk.yellow('   No games yet.'));
        return;
      }

      const limit = 5;
      const start = Math.max(0, totalSessions - limit);

      for (let i = totalSessions - 1; i >= start; i--) {
        const sessionID = BigInt(i);
        const [config, balance] = await Promise.all([
             client.state.box.gameSessions.value(sessionID),
             client.state.box.sessionBalances.value(sessionID)
        ]);

        if (!config) continue;

        let label = '🔴 EXPIRED';
        if (currentRound < config.startAt) label = '⏳ WAITING';
        else if (currentRound <= config.endCommitAt) label = '🟢 BUYING OPEN';
        else if (currentRound <= config.endRevealAt) label = '🟡 REVEAL OPEN';
        else label = '🏁 CLAIMABLE';

        console.log(chalk.white(`🔹 ID: ${i} [${label}]`));
        console.log(chalk.gray(`   Price: ${config.participation} µAlgo | Pool: ${balance} µAlgo`));
        console.log(chalk.gray(`   Commit: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`));
        console.log(chalk.gray(`   Reveal: ${config.endRevealAt} ${getRoundDiff(currentRound, config.endRevealAt)}`));
        console.log('');      
      }
    } catch (e: any) { handleAlgoError(e, 'Status'); }
  },

  /**
   * Checks if the user won the lottery and claims the winnings.
   */
  claim: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      console.log(chalk.yellow('💵 Checking for winnings...'));
      
      // Use coverAppCallInnerTransactionFees to pay for the payout transaction from the user's wallet
      const result = await client.send.claimWinnings({
        args: { sessionId: sessionID },
        coverAppCallInnerTransactionFees: true, 
        maxFee: AlgoAmount.MicroAlgo(3000),
      });

      if (result.return === 0n) {
          console.log(chalk.red('💀 No winnings for you.'));
      } else {
          console.log(chalk.green(`🎉 JACKPOT! Claimed ${result.return} µAlgo!`));
      }
    } catch (e: any) { handleAlgoError(e, 'Claim'); }
  },
};
