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
    StagHuntClient, 
    StagHuntFactory 
} from '../../smart_contracts/artifacts/stagHunt/StagHuntClient';
import { UI } from '../ui';
import { microAlgo } from '@algorandfoundation/algokit-utils';

const getClient = async (wallet: WalletManager) => {
  const appId = await getAppId(wallet, 'STAGHUNT');
  return new StagHuntClient({
    algorand: wallet.algorand,
    appId,
    defaultSender: wallet.account!.addr,
  });
};

const askSessionId = async () => {
  const answers = await inquirer.prompt([{
    type: 'input', name: 'sessId', message: 'Enter SESSION ID:',
    validate: (i) => !isNaN(parseInt(i)) || 'Invalid Number',
  }]);
  return BigInt(answers.sessId);
};

export const StagHuntModule: IGameModule = {
  id: 'STAGHUNT',
  name: '🦌 Stag Hunt',

  getAvailableActions: (): GameAction[] => [
    { name: '🚀 Deploy New Contract', value: 'deploy' },
    { name: '🆕 Create New Game Session', value: 'create', separator: true },
    { name: '🤝 Join (Commit)', value: 'join' },
    { name: '🔓 Reveal Move', value: 'reveal' },
    { name: '⚖️  Resolve Outcome', value: 'resolve' },
    { name: '📊 Dashboard', value: 'status', separator: true },
    { name: '💵 Claim Winnings/Refund', value: 'claim' },
  ],

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
        await appClient.send.initialize({ args: { gameType: 'STAGHUNT' }, sender: wallet.account.addr });
        console.log(chalk.green('✅ Contract type: STAGHUNT'));

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

  create: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const answers = await inquirer.prompt([
        { 
            type: 'input', 
            name: 'participation', 
            message: 'Participation Fee (MicroAlgo)?', 
            default: '1000000' 
        },
        { 
            type: 'input', 
            name: 'startDelay', 
            message: 'Start delay (rounds)?', 
            default: '1' 
        },
        { 
            type: 'input', 
            name: 'commitDuration', 
            message: 'Commit duration (rounds)?', 
            default: '50' 
        },
        { 
            type: 'input', 
            name: 'revealDuration', 
            message: 'Reveal duration (rounds)?', 
            default: '50' 
        },
      ]);

      const currentRound = await getCurrentRound(wallet);
      const startAt = currentRound + 1n + BigInt(answers.startDelay);
      const endCommitAt = startAt + BigInt(answers.commitDuration);
      const endRevealAt = endCommitAt + BigInt(answers.revealDuration);
      const participation = BigInt(answers.participation);

      console.log(chalk.yellow('⏳ Calculating MBR (includes Stats box)...'));
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

  join: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();

      const sessionConfig = await client.state.box.gameSessions.value(sessionID);
      if (!sessionConfig) throw new Error('Session not found');

      console.log(chalk.cyan(`💰 Stake: ${sessionConfig.participation} µAlgo`));

      const { choice } = await inquirer.prompt([{
        type: 'list', name: 'choice', message: 'Choose your strategy:', 
        choices: [
            {name: '🦌 Stag (High Risk/High Reward)', value: 1}, 
            {name: '🐇 Hare (Low Risk/Refund)', value: 0}
        ]
      }]);

      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      console.log(chalk.bgRed.white(` ⚠️  SECRET SALT: ${Buffer.from(salt).toString('hex')} (SAVE IT!) `));

      const choiceBytes = algosdk.encodeUint64(choice);
      const combined = new Uint8Array([...choiceBytes, ...salt]);
      const hash = new Uint8Array(sha256.array(combined));

      console.log(chalk.yellow('📡 Committing Strategy...'));
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

      console.log(chalk.green('✅ Strategy Committed!'));
    } catch (e: any) { handleAlgoError(e, 'Join Session'); }
  },

  reveal: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const answers = await inquirer.prompt([
        { type: 'input', name: 'sessId', message: 'Enter SESSION ID:', validate: i => !isNaN(parseInt(i)) || 'Invalid' },
        { 
            type: 'list', name: 'choice', message: 'Your original choice:', 
            choices: [{name: 'Stag', value: 1}, {name: 'Hare', value: 0}]
        },
        { type: 'input', name: 'salt', message: 'Paste SECRET SALT (Hex):' },
      ]);

      const sessionID = BigInt(answers.sessId);
      const choice = BigInt(answers.choice);
      const salt = new Uint8Array(Buffer.from(answers.salt.replace('0x', ''), 'hex'));

      console.log(chalk.yellow(`🔓 Revealing...`));
      await client.send.revealMove({
        args: { sessionId: sessionID, choice, salt },
        suppressLog: true,
      });

      console.log(chalk.green('✅ Move Revealed!'));
    } catch (e: any) { handleAlgoError(e, 'Reveal'); }
  },

  resolve: async (wallet: WalletManager) => {
    try {
        const client = await getClient(wallet);
        const sessionID = await askSessionId();
        
        console.log(chalk.yellow('⚖️  Resolving Session Outcome...'));
        await client.send.resolveSession({ 
            args: { sessionId: sessionID },
            coverAppCallInnerTransactionFees: true, 
            maxFee: microAlgo(3000)
        });
        console.log(chalk.green('✅ Session Resolved! You can now claim if eligible.'));
    } catch (e: any) { handleAlgoError(e, 'Resolve'); }
  },

  status: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const currentRound = await getCurrentRound(wallet);
      const globalState = await client.state.global.getAll();
      const totalSessions = Number(globalState.sessionIdCounter || 0);

      UI.printTitle('📊 DASHBOARD STAG HUNT');
      console.log(chalk.white(`🌍 Current Round: ${chalk.bold(currentRound)}`));
      console.log(chalk.yellow(`💰 Global Jackpot: ${globalState.globalJackpot} µAlgo`));
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
             client.state.box.stats.value(sessionID)
        ]);

        if (!config) continue;

        let label = '🔴 EXPIRED';
        if (currentRound < config.startAt) label = '⏳ WAITING';
        else if (currentRound <= config.endCommitAt) label = '🟢 COMMIT OPEN';
        else if (currentRound <= config.endRevealAt) label = '🟡 REVEAL OPEN';
        else if (!stats?.resolved) label = '⚖️  NEEDS RESOLVE';
        else label = '🏁 FINISHED';

        console.log(chalk.white(`🔹 ID: ${i} [${label}]`));
        console.log(chalk.gray(`   Stake: ${config.participation} µAlgo | Pool: ${balance} µAlgo`));
        if(stats) {
            console.log(chalk.gray(`   Stags: ${stats.stags} | Hares: ${stats.hares} | Resolved: ${stats.resolved ? 'Yes' : 'No'}`));
            if(stats.resolved) console.log(chalk.white(`   Successful Hunt: ${stats.successful ? '✅ YES' : '❌ NO'}`));
        }
        
        // MODIFICATO QUI PER MOSTRARE ENTRAMBI I DEADLINE
        console.log(chalk.gray(`   Commit: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`));
        console.log(chalk.gray(`   Reveal: ${config.endRevealAt} ${getRoundDiff(currentRound, config.endRevealAt)}`));
        console.log('');
      }
    } catch (e: any) { handleAlgoError(e, 'Status'); }
  },

  claim: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      console.log(chalk.yellow('💵 Claiming...'));
      
      const result = await client.send.claimWinnings({
        args: { sessionId: sessionID },
        coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(3000),
      });

      if (result.return === 0n) {
          console.log(chalk.red('💀 Received 0. (Coordination failed or you defected?)'));
      } else {
          console.log(chalk.green(`🎉 Received ${result.return} µAlgo!`));
      }
    } catch (e: any) { handleAlgoError(e, 'Claim'); }
  },
};
