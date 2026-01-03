/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { IGameModule, GameAction } from '../interfaces';
import { WalletManager } from '../walletManager';
import { getAppId, getCurrentRound, getRoundDiff, handleAlgoError } from '../utils';
import chalk from 'chalk';
import inquirer from 'inquirer';
import algosdk from 'algosdk';
import { sha256 } from 'js-sha256';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';

import { 
    StagHuntClient, 
    StagHuntFactory 
} from '../../smart_contracts/artifacts/stagHunt/StagHuntClient';
import { UI } from '../ui';

export const StagHuntModule: IGameModule = {
  id: 'STAGHUNT',
  name: '🦌 Stag Hunt (Cooperation Game)',

  getAvailableActions: (): GameAction[] => [
    { name: '🚀 Deploy New Contract', value: 'deploy' },
    { name: '🆕 Create New Game Session', value: 'create', separator: true },
    { name: '👋 Join Existing Game', value: 'join' },
    { name: '🔓 Reveal Move', value: 'reveal' },
    { name: '⚙️  Resolve Game', value: 'resolve', separator: true },
    { name: '💰 Claim Winnings', value: 'claim' },
    { name: '👀 Check Status (Dashboard)', value: 'status', separator: true },
  ],

  // DEPLOY
  deploy: async (wallet: WalletManager) => {
    console.log(chalk.yellow('🚀 Starting Deployment...'));    
    if (!wallet.account) return;

    try {
      const uniqueAppName = `StagHunt_${Date.now()}`;
      const factory = wallet.algorand.client.getTypedAppFactory(StagHuntFactory, {
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
          args: { gameType: 'STAGHUNT' },
          sender: wallet.account.addr,
        });
        
        console.log(chalk.green('✅ Contract type: STAGHUNT'));

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
      const appId = await getAppId(wallet, 'STAGHUNT');
      const client = new StagHuntClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      console.log(chalk.blue(`Connected to App ID: ${appId}`));

      // Show current rules
      const globalState = await client.state.global.getAll();
      console.log(chalk.cyan(`\n📌 Current Game Rules:`));
      console.log(chalk.gray(`   Hare Refund: ${globalState.hareRefundPercent}%`));
      console.log(chalk.gray(`   Stag Threshold: ${globalState.stagThresholdPercent}%`));
      console.log(chalk.gray(`   Global Jackpot: ${globalState.globalJackpot} µAlgo`));

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'participation',
          message: 'Participation Fee (MicroAlgo)?',
          default: '10000000',
          validate: (i) => {
            const val = parseInt(i);
            if (isNaN(val)) return 'Invalid number';
            if (val < 1000000) return 'Minimum is 1 ALGO (1000000 µAlgo)';
            return true;
          },
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
    } catch (e: any) {
      handleAlgoError(e, 'Create Session');
    }
  },

  // JOIN
  join: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'STAGHUNT');
      const client = new StagHuntClient({
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

      // Show game rules
      const globalState = await client.state.global.getAll();
      console.log(chalk.cyan(`\n💰 Entry Fee: ${participationFee} µAlgo`));
      console.log(chalk.cyan(`📌 Current Rules:`));
      console.log(chalk.gray(`   Hare Refund: ${globalState.hareRefundPercent}%`));
      console.log(chalk.gray(`   Stag Threshold: ${globalState.stagThresholdPercent}%`));
      console.log(chalk.yellow(`   Global Jackpot: ${globalState.globalJackpot} µAlgo`));

      const { choice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'choice',
          message: 'Make your choice:',
          choices: [
            {
              name: `🐰 HARE (Safe) - Guaranteed ${globalState.hareRefundPercent}% refund`,
              value: 0,
            },
            {
              name: `🦌 STAG (Risk) - Win jackpot if ${globalState.stagThresholdPercent}% cooperate, lose all otherwise`,
              value: 1,
            },
          ],
        },
      ]);

      // Generate commit hash
      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      console.log(chalk.bgRed.white(` ⚠️  SECRET SALT: ${Buffer.from(salt).toString('hex')} (SAVE IT!) `));

      const choiceBytes = algosdk.encodeUint64(choice);
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
      console.log(chalk.cyan(`Your choice: ${choice === 0 ? '🐰 HARE' : '🦌 STAG'}`));
    } catch (e: any) {
      handleAlgoError(e, 'Join Session');
    }
  },

  // REVEAL
  reveal: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'STAGHUNT');
      const client = new StagHuntClient({
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
          type: 'list',
          name: 'choice',
          message: 'Your original choice?',
          choices: [
            { name: '🐰 HARE', value: 0 },
            { name: '🦌 STAG', value: 1 },
          ],
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
      console.log(chalk.blue('ℹ️  After reveal phase ends, someone must call RESOLVE before claiming!'));
    } catch (e: any) {
      handleAlgoError(e, 'Reveal');
    }
  },

  // RESOLVE
  resolve: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'STAGHUNT');
      const client = new StagHuntClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      const { resolveSessionId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'resolveSessionId',
          message: 'Enter SESSION ID to resolve:',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid',
        },
      ]);

      console.log(chalk.yellow('⚙️  Resolving game...'));

      await client.send.resolveSession({
        args: { sessionId: BigInt(resolveSessionId) },
        sender: wallet.account!.addr,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(5000),
      });

      console.log(chalk.green('✅ Game resolved! You can now claim prizes.'));
    } catch (e: any) {
      handleAlgoError(e, 'Resolve');
    }
  },

  // CLAIM
  claim: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'STAGHUNT');
      const client = new StagHuntClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

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
        maxFee: AlgoAmount.MicroAlgo(3000),
      });

      if (result.return === 0n) {
        console.log(chalk.red('💀 No winnings (you were a Stag and coordination failed)'));
      } else {
        console.log(chalk.green(`✅ Claimed ${result.return} µAlgo!`));
      }
    } catch (e: any) {
      handleAlgoError(e, 'Claim');
    }
  },

  // STATUS
  status: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'STAGHUNT');
      const client = new StagHuntClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      console.log(chalk.gray('🔄 Fetching Data...'));
      const currentRound = await getCurrentRound(wallet);

      const globalState = await client.state.global.getAll();
      const totalSessions = Number(globalState.sessionIdCounter!);

      UI.printTitle('📊 DASHBOARD STAG HUNT');
      console.log(chalk.white(`🌍 Current Round: ${chalk.bold(currentRound)}`));
      console.log(chalk.white(`🔢 Total Games: ${totalSessions}`));
      console.log(chalk.yellow(`💰 Global Jackpot: ${globalState.globalJackpot} µAlgo`));
      console.log(chalk.cyan(`📌 Hare Refund: ${globalState.hareRefundPercent}% | Stag Threshold: ${globalState.stagThresholdPercent}%`));
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
        else if (stats && stats.resolved) {
          label = stats.successful ? '🏆 SUCCESS' : '💀 FAILED';
        } else {
          label = '⚙️ NEEDS RESOLVE';
        }

        console.log(chalk.white(`🔹 ID: ${i} [${label}]`));
        console.log(chalk.gray(`   Fee: ${config.participation} µAlgo | Pot: ${balance} µAlgo`));

        if (stats) {
          console.log(chalk.gray(`   Stags: ${stats.stags} | Hares: ${stats.hares}`));
          if (stats.resolved) {
            console.log(
              chalk.gray(
                `   Outcome: ${stats.successful ? chalk.green('COOPERATION') : chalk.red('PANIC')}`
              )
            );
            if (stats.successful) {
              console.log(chalk.gray(`   Reward per Stag: ${stats.rewardPerStag} µAlgo`));
            }
          }
        }

        console.log(chalk.gray(`   Commit: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`));
        console.log(chalk.gray(`   Reveal: ${config.endRevealAt} ${getRoundDiff(currentRound, config.endRevealAt)}`));
        console.log('');
      }
    } catch (e: any) {
      handleAlgoError(e, 'Status');
    }
  },
};
