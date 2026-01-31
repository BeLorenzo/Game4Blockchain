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
    RockPaperScissorsClient, 
    RockPaperScissorsFactory 
} from '../../smart_contracts/artifacts/RockPaperScissors/RockPaperScissorsClient';
import { UI } from '../ui';

export const RPSGameModule: IGameModule = {
  id: 'RPS',
  name: '🪨📄✂️  Rock Paper Scissors',

  getAvailableActions: (): GameAction[] => [
    { name: '🚀 Deploy New Contract', value: 'deploy' },
    { name: '🆕 Create New Game Session', value: 'create', separator: true },
    { name: '👋 Join Existing Game', value: 'join' },
    { name: '🔓 Reveal Move', value: 'reveal' },
    { name: '💰 Claim Winnings', value: 'claim', separator: true }, // NUOVO: Sostituisce Timeout
    { name: '📊 Dashboard', value: 'status' },
  ],

  /**
   * Deploys the Rock Paper Scissors Factory contract.
   */
  deploy: async (wallet: WalletManager) => {
    console.log(chalk.yellow('🚀 Starting Deployment...'));    
    if (!wallet.account) return;

    try {
      const uniqueAppName = `RockPaperScissors_${Date.now()}`;
      const factory = wallet.algorand.client.getTypedAppFactory(RockPaperScissorsFactory, {
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
          args: { gameType: 'RPS' },
          sender: wallet.account.addr,
        });
        
        console.log(chalk.green('✅ Contract type: RPS'));

        // Fund MBR
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

  /**
   * Creates a new game session.
   */
  create: async (wallet: WalletManager) => {
    try {
        const appId = await getAppId(wallet, 'RPS'); 
        const client = new RockPaperScissorsClient({
            algorand: wallet.algorand,
            appId,
            defaultSender: wallet.account!.addr,
        });

        console.log(chalk.blue(`Connected to App ID: ${appId}`));

        const answers = await inquirer.prompt([
            { type: 'input', name: 'participation', message: 'Participation Fee (MicroAlgo)?', default: '1000000', validate: (i) => !isNaN(parseInt(i)) || 'Invalid number' },
            { type: 'input', name: 'startDelay', message: 'Start delay (rounds)?', default: '1', validate: (i) => !isNaN(parseInt(i)) || 'Invalid number' },
            { type: 'input', name: 'duration', message: 'Commit duration (rounds)?', default: '10', validate: (i) => !isNaN(parseInt(i)) || 'Invalid number' },
            { type: 'input', name: 'reveal', message: 'Reveal duration (rounds)?', default: '10', validate: (i) => !isNaN(parseInt(i)) || 'Invalid number' },
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

  /**
   * Joins an existing game session.
   */
  join: async (wallet: WalletManager) => {
    try {
        const appId = await getAppId(wallet, 'RPS');
        const client = new RockPaperScissorsClient({
            algorand: wallet.algorand,
            appId,
            defaultSender: wallet.account!.addr,
        });

        const answers = await inquirer.prompt([
            { type: 'input', name: 'sessId', message: 'Enter SESSION ID:', validate: (i) => !isNaN(parseInt(i)) || 'Invalid Number' },
            { type: 'list', name: 'move', message: 'Make your move:', choices: [{ name: 'Rock', value: 0 }, { name: 'Paper', value: 1 }, { name: 'Scissors', value: 2 }] },
        ]);

        const sessionID = BigInt(answers.sessId);
        const choice = Number(answers.move);

        console.log(chalk.gray('🔎 Reading Session Config...'));

        const sessionConfig = await client.state.box.gameSessions.value(sessionID);
        if (!sessionConfig) throw new Error("session not found");
        const participationFee = sessionConfig.participation;
        console.log(chalk.cyan(`💰 Fee required: ${participationFee} µAlgo`));

        const mbrResult = await client.send.getRequiredMbr({ args: { command: 'join' }, suppressLog: true });
        const requiredMBR = mbrResult.return!;

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
                payment: await wallet.algorand.createTransaction.payment({ sender: wallet.account!.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(Number(participationFee)) }),
                mbrPayment: await wallet.algorand.createTransaction.payment({ sender: wallet.account!.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(Number(requiredMBR)) }),
            },
            suppressLog: true,
        });

        console.log(chalk.green('✅ Joined Successfully!'));

    } catch (e: any) {
        handleAlgoError(e, 'Join Session');
    }
  },

  /**
   * Reveals the move.
   */
  reveal: async (wallet: WalletManager) => {
    try {
        const appId = await getAppId(wallet, 'RPS');
        const client = new RockPaperScissorsClient({
            algorand: wallet.algorand,
            appId,
            defaultSender: wallet.account!.addr,
        });

        const answers = await inquirer.prompt([
            { type: 'input', name: 'sessId', message: 'Enter SESSION ID to reveal:', validate: (i) => !isNaN(parseInt(i)) || 'Invalid' },
            { type: 'list', name: 'move', message: 'Your original move?', choices: [{ name: 'Rock', value: 0 }, { name: 'Paper', value: 1 }, { name: 'Scissors', value: 2 }] },
            { type: 'input', name: 'salt', message: 'Paste SECRET SALT (Hex):' },
        ]);

        const sessionId = BigInt(answers.sessId);
        const choice = BigInt(answers.move);
        const salt = new Uint8Array(Buffer.from(answers.salt.replace('0x', ''), 'hex'));

        console.log(chalk.yellow(`🔓 Revealing...`));

        await client.send.revealMove({
            args: { sessionId, choice, salt },
            suppressLog: true,
        });

        console.log(chalk.green('✅ Reveal Successful!'));
        console.log(chalk.cyan('👉 Now wait for your opponent to reveal, then use "Claim Winnings" to check results.'));

    } catch (e: any) {
        handleAlgoError(e, 'Reveal');
    }
  },

  /**
   * Claims winnings.
   * This works for both normal victories and timeouts.
   */
  claim: async (wallet: WalletManager) => {
    try {
        const appId = await getAppId(wallet, 'RPS');
        const client = new RockPaperScissorsClient({
            algorand: wallet.algorand,
            appId,
            defaultSender: wallet.account!.addr,
        });

        const { sessId } = await inquirer.prompt([
            { type: 'input', name: 'sessId', message: 'Enter SESSION ID to claim:', validate: (i) => !isNaN(parseInt(i)) || 'Invalid' },
        ]);

        const sessionId = BigInt(sessId);

        console.log(chalk.yellow(`💰 Checking for winnings...`));

        const result = await client.send.claimWinnings({
            args: { sessionId },
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(2000),
            suppressLog: true,
        });

        const innerTxns = result.confirmation['innerTxns'] || [];
        let totalWon = 0;
        
        innerTxns.forEach((txn: any) => {
            if (txn.payment && txn.payment.receiver === wallet.account!.addr) {
                totalWon += txn.payment.amount;
            }
        });

        if (totalWon > 0) {
            console.log(chalk.green(`\n🏆 CLAIM SUCCESSFUL!`));
            console.log(chalk.bold.yellow(`💸 You received: ${totalWon / 1_000_000} ALGO`));
        } else {
            console.log(chalk.green(`\n✅ Claim processed.`));
            console.log(chalk.gray(`(If you received 0, you might have lost, or funds were already claimed)`));
        }

    } catch (e: any) {
        handleAlgoError(e, 'Claim Winnings');
    }
  },

  /**
   * Displays the current status.
   */
  status: async (wallet: WalletManager) => {
    try {
        const appId = await getAppId(wallet, 'RPS');
        const client = new RockPaperScissorsClient({ algorand: wallet.algorand, appId, defaultSender: wallet.account!.addr });
        
        console.log(chalk.gray('🔄 Fetching Data...'));
        const currentRound = await getCurrentRound(wallet);
        
        const totalSessions = Number((await client.state.global.getAll()).sessionIdCounter!);

        UI.printTitle('📊 DASHBOARD RPS');
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
            const [config, players, finishedMask] = await Promise.all([
                client.state.box.gameSessions.value(sessionID),
                client.state.box.sessionPlayers.value(sessionID),
                client.state.box.gameFinished.value(sessionID)
            ]);

            if (!config || !players) continue;

            let label = '🔴 EXPIRED';
            const mask = Number(finishedMask);

            if (mask === 3) label = '🏁 FINISHED';
            else if (mask > 0) label = '💰 CLAIMING'; 
            else if (currentRound < config.startAt) label = '⏳ WAITING';
            else if (currentRound <= config.endCommitAt) label = '🟢 COMMIT OPEN';
            else if (currentRound <= config.endRevealAt) label = '🟡 REVEAL OPEN';
            else if (currentRound > config.endRevealAt) label = '⚠️  TIMEOUT / CLAIM';

            const p1 = players.p1 === algosdk.ALGORAND_ZERO_ADDRESS_STRING ? '[Empty]' : wallet.shortAddr(players.p1);
            const p2 = players.p2 === algosdk.ALGORAND_ZERO_ADDRESS_STRING ? '[Empty]' : wallet.shortAddr(players.p2);

            console.log(chalk.white(`🔹 ID: ${i} [${label}]`));
            console.log(chalk.gray(`   Fee: ${config.participation} | P1: ${p1} vs P2: ${p2}`));
            console.log(chalk.gray(`   Commit: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`));
            console.log(chalk.gray(`   Reveal: ${config.endRevealAt} ${getRoundDiff(currentRound, config.endRevealAt)}`));
            console.log('');
        }

    } catch (e: any) {
        handleAlgoError(e, 'Status');
    }
  },
};
