/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { IGameModule } from '../interfaces';
import { WalletManager } from '../walletManager';
import { getAppId, getCurrentRound, getRoundDiff, handleAlgoError } from '../utils';
import chalk from 'chalk';
import inquirer from 'inquirer';
import algosdk from 'algosdk';
import { sha256 } from 'js-sha256';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';

import { 
    GuessGameClient, 
    GuessGameFactory 
} from '../../smart_contracts/artifacts/guessGame/GuessGameClient';
import { UI } from '../ui';

export const GuessGameModule: IGameModule = {
  id: 'GUESS',
  name: '🎯 Guess 2/3 of the Average',

  // DEPLOY
  deploy: async (wallet: WalletManager) => {
    console.log(chalk.yellow('🚀 Starting Deployment...'));    
    if (!wallet.account) return;

    try {
      const uniqueAppName = `GuessGame_${Date.now()}`;
      const factory = wallet.algorand.client.getTypedAppFactory(GuessGameFactory, {
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
        
        await appClient.send.initialize({
          args: { gameType: 'GUESS' },
          sender: wallet.account.addr,
        });
        
        console.log(chalk.green('✅ Contract type: GUESS'));

        await wallet.algorand.send.payment({
          amount: AlgoAmount.Algos(1),
          sender: wallet.account.addr,
          receiver: appClient.appAddress,
        });
      }

      console.log(chalk.green(`\n✅ DEPLOYMENT SUCCESSFUL!`));
      console.log(chalk.bgGreen.black(` APP ID: ${appClient.appId} `));
      
    } catch (e: any) {
      handleAlgoError(e, 'Deploy');
    }
  },

  // CREATE
  create: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'GUESS');
      const client = new GuessGameClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      console.log(chalk.blue(`Connected to App ID: ${appId}`));

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'participation',
          message: 'Participation Fee (MicroAlgo)?',
          default: '1000000',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid number',
        },
        {
          type: 'input',
          name: 'startDelay',
          message: 'Start delay (rounds)?',
          default: '1',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid number',
        },
        {
          type: 'input',
          name: 'duration',
          message: 'Commit duration (rounds)?',
          default: '50',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid number',
        },
        {
          type: 'input',
          name: 'reveal',
          message: 'Reveal duration (rounds)?',
          default: '50',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid number',
        },
      ]);

      const currentRound = await getCurrentRound(wallet);
      const startAt = currentRound + 1n + BigInt(answers.startDelay);
      const endCommitAt = startAt + BigInt(answers.duration);
      const endRevealAt = endCommitAt + BigInt(answers.reveal);
      const participation = BigInt(answers.participation);

      console.log(chalk.yellow('⏳ Calculating MBR and Creating Session...'));

      const mbrResult = await client.send.getRequiredMbr({
        args: { command: 'newGame' },
        suppressLog: true,
      });
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
      console.log(chalk.cyan(`\n🎯 Strategy Tips:`));
      console.log(chalk.gray(`   Nash Equilibrium: 0`));
      console.log(chalk.gray(`   Typical Range: 15-40`));
      console.log(chalk.gray(`   Think about what others will choose!`));
    } catch (e: any) {
      handleAlgoError(e, 'Create Session');
    }
  },

  // JOIN
  join: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'GUESS');
      const client = new GuessGameClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'sessId',
          message: 'Enter SESSION ID:',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid Number',
        },
      ]);

      const sessionID = BigInt(answers.sessId);

      console.log(chalk.gray('🔎 Reading Session Config...'));

      const sessionConfig = await client.state.box.gameSessions.value(sessionID);
      if (!sessionConfig) throw new Error('Session not found');
      const participationFee = sessionConfig.participation;
      console.log(chalk.cyan(`💰 Fee required: ${participationFee} µAlgo`));

      console.log(chalk.yellow(`\n🎯 Game Rules:`));
      console.log(chalk.gray(`   1. Everyone picks a number from 0 to 100`));
      console.log(chalk.gray(`   2. Average is calculated`));
      console.log(chalk.gray(`   3. Target = 2/3 × Average`));
      console.log(chalk.gray(`   4. Winner = Closest to target`));

      const { choice } = await inquirer.prompt([
        {
          type: 'input',
          name: 'choice',
          message: 'Your guess (0-100):',
          validate: (i) => {
            const val = parseInt(i);
            if (isNaN(val)) return 'Invalid number';
            if (val < 0 || val > 100) return 'Must be between 0 and 100';
            return true;
          },
        },
      ]);

      const choiceNum = parseInt(choice);

      // Generate commit hash
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      console.log(chalk.bgRed.white(` ⚠️  SECRET SALT: ${Buffer.from(salt).toString('hex')} (SAVE IT!) `));

      const choiceBytes = algosdk.encodeUint64(choiceNum);
      const combined = new Uint8Array([...choiceBytes, ...salt]);
      const hash = new Uint8Array(sha256.array(combined));

      console.log(chalk.yellow(`📡 Joining...`));

      await client.send.joinSession({
        args: {
          sessionId: sessionID,
          commit: hash,
          payment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(participationFee)),
          }),
        },
        suppressLog: true,
      });

      console.log(chalk.green('✅ Joined Successfully!'));
      console.log(chalk.cyan(`🎯 Your guess: ${choiceNum}`));
    } catch (e: any) {
      handleAlgoError(e, 'Join Session');
    }
  },

  // REVEAL
  reveal: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'GUESS');
      const client = new GuessGameClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'sessId',
          message: 'Enter SESSION ID to reveal:',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid',
        },
        {
          type: 'input',
          name: 'choice',
          message: 'Your original guess (0-100):',
          validate: (i) => {
            const val = parseInt(i);
            if (isNaN(val)) return 'Invalid number';
            if (val < 0 || val > 100) return 'Must be between 0 and 100';
            return true;
          },
        },
        {
          type: 'input',
          name: 'salt',
          message: 'Paste SECRET SALT (Hex):',
        },
      ]);

      const sessionId = BigInt(answers.sessId);
      const choice = BigInt(answers.choice);
      const salt = new Uint8Array(Buffer.from(answers.salt.replace('0x', ''), 'hex'));

      console.log(chalk.yellow(`🔓 Revealing...`));

      await client.send.revealMove({
        args: { sessionId, choice, salt },
        suppressLog: true,
      });

      console.log(chalk.green('✅ Reveal Successful!'));
      console.log(chalk.blue('ℹ️  Wait for all players to reveal, then claim your prize!'));
    } catch (e: any) {
      handleAlgoError(e, 'Reveal');
    }
  },

  // STATUS
  getStatus: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'GUESS');
      const client = new GuessGameClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      console.log(chalk.gray('🔄 Fetching Data...'));
      const currentRound = await getCurrentRound(wallet);

      const totalSessions = Number((await client.state.global.getAll()).sessionIdCounter!);

      UI.printTitle('📊 DASHBOARD GUESS 2/3 AVERAGE');
      console.log(chalk.white(`🌍 Current Round: ${chalk.bold(currentRound)}`));
      console.log(chalk.white(`🔢 Total Games: ${totalSessions}`));
      UI.separator();

      if (totalSessions === 0) {
        console.log(chalk.yellow('   No games yet.'));
        return;
      }

      const limit = 5;
      const start = Math.max(0, totalSessions - limit);

      for (let i = totalSessions - 1; i >= start; i--) {
        const sessionID = BigInt(i);
        const [config, balance, stats] = await Promise.all([
          client.state.box.gameSessions.value(sessionID),
          client.state.box.sessionBalances.value(sessionID),
          client.state.box.stats.value(sessionID),
        ]);

        if (!config) continue;

        let label = '🔴 EXPIRED';
        if (currentRound < config.startAt) label = '⏳ WAITING';
        else if (currentRound <= config.endCommitAt) label = '🟢 COMMIT OPEN';
        else if (currentRound <= config.endRevealAt) label = '🟡 REVEAL OPEN';
        else label = '🏁 CLAIMABLE';

        console.log(chalk.white(`🔹 ID: ${i} [${label}]`));
        console.log(chalk.gray(`   Fee: ${config.participation} µAlgo | Pot: ${balance} µAlgo`));

        if (stats && stats.count > 0) {
          const average = Number(stats.sum) / Number(stats.count);
          const target = Math.floor((average * 2) / 3);
          console.log(chalk.gray(`   Players: ${stats.count} | Sum: ${stats.sum}`));
          console.log(chalk.cyan(`   Average: ${average.toFixed(2)} | Target: ${target}`));
        }

        console.log(chalk.gray(`   Commit: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`));
        console.log(chalk.gray(`   Reveal: ${config.endRevealAt} ${getRoundDiff(currentRound, config.endRevealAt)}`));
        console.log('');
      }

      // Add claim option
      const { wantToClaim } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'wantToClaim',
          message: 'Do you want to claim winnings from a finished game?',
          default: false,
        },
      ]);

      if (wantToClaim) {
        const { claimSessionId } = await inquirer.prompt([
          {
            type: 'input',
            name: 'claimSessionId',
            message: 'Enter SESSION ID to claim:',
            validate: (i) => !isNaN(parseInt(i)) || 'Invalid',
          },
        ]);

        console.log(chalk.yellow('💰 Claiming winnings...'));

        const result = await client.send.claimWinnings({
          args: { sessionId: BigInt(claimSessionId) },
          sender: wallet.account!.addr,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(4000),
        });

        if (result.return === 0n) {
          console.log(chalk.red('💀 You did not win this round!'));
        } else {
          console.log(chalk.green(`🎉 Victory! Claimed ${result.return} µAlgo!`));
        }
      }
    } catch (e: any) {
      handleAlgoError(e, 'Status');
    }
  },
};
