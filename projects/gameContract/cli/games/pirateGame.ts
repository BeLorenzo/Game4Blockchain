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
    PirateGameClient, 
    PirateGameFactory 
} from '../../smart_contracts/artifacts/pirateGame/PirateGameClient';
import { UI } from '../ui';

const PHASES = ['Registration', 'Proposal', 'Vote Commit', 'Vote Reveal', 'Finished'];

export const PirateGameModule: IGameModule = {
  id: 'PIRATE',
  name: '🏴‍☠️ Pirate Game (Iterative Elimination)',

  getAvailableActions: (): GameAction[] => [
    { name: '🚀 Deploy New Contract', value: 'deploy' },
    { name: '🆕 Create New Game Session', value: 'create', separator: true },
    { name: '🏴‍☠️ Register as Pirate', value: 'join' },
    { name: '⚔️ Game Actions Menu', value: 'reveal', separator: true },
    { name: '👀 Check Status (Dashboard)', value: 'status' },
  ],

  deploy: async (wallet: WalletManager) => {
    console.log(chalk.yellow('🚀 Starting Deployment...'));    
    if (!wallet.account) return;

    try {
      const uniqueAppName = `PirateGame_${Date.now()}`;
      const factory = wallet.algorand.client.getTypedAppFactory(PirateGameFactory, {
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
          args: { gameType: 'PIRATE' },
          sender: wallet.account.addr,
        });
        
        console.log(chalk.green('✅ Contract type: PIRATE'));

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

  create: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'PIRATE');
      const client = new PirateGameClient({
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
          validate: (i) => {
            const val = parseInt(i);
            if (isNaN(val)) return 'Invalid number';
            if (val < 1000000) return 'Minimum is 1 ALGO (1000000 µAlgo)';
            return true;
          },
        },
        {
          type: 'input',
          name: 'maxPirates',
          message: 'Maximum Pirates (3-20)?',
          default: '5',
          validate: (i) => {
            const val = parseInt(i);
            if (isNaN(val)) return 'Invalid number';
            if (val < 3 || val > 20) return 'Must be between 3 and 20';
            return true;
          },
        },
        {
          type: 'input',
          name: 'registrationDuration',
          message: 'Registration duration (rounds)?',
          default: '50',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid number',
        },
        {
          type: 'input',
          name: 'roundDuration',
          message: 'Round duration (rounds)?',
          default: '30',
          validate: (i) => {
            const val = parseInt(i);
            if (isNaN(val)) return 'Invalid number';
            if (val < 10) return 'Minimum is 10 rounds';
            return true;
          },
        },
      ]);

      const currentRound = await getCurrentRound(wallet);
      const startAt = currentRound + 5n;
      const participation = BigInt(answers.participation);
      const maxPirates = BigInt(answers.maxPirates);
      const roundDuration = BigInt(answers.roundDuration);

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
          config: { 
            startAt, 
            endCommitAt: startAt + 10n,
            endRevealAt: startAt + 20n,
            participation 
          },
          mbrPayment: mbrPaymentTxn,
          maxPirates,
          roundDuration,
        },
        suppressLog: true,
      });

      console.log(chalk.green(`✅ Session Created!`));
      console.log(chalk.bgGreen.black(` 👉 SESSION ID: ${result.return} `));
      console.log(chalk.cyan(`\n🏴‍☠️ Game Mechanics:`));
      console.log(chalk.gray(`   - ${maxPirates} pirates compete for the treasure`));
      console.log(chalk.gray(`   - Each round: propose → vote → eliminate`));
      console.log(chalk.gray(`   - Win: Get majority approval for your split`));
    } catch (e: any) {
      handleAlgoError(e, 'Create Session');
    }
  },

  join: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'PIRATE');
      const client = new PirateGameClient({
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
      
      const state = await client.state.box.gameState.value(sessionID);
      if (!state) throw new Error('Game state not found');

      console.log(chalk.cyan(`💰 Entry Fee: ${participationFee} µAlgo`));
      console.log(chalk.cyan(`🏴‍☠️ Pirates Registered: ${state.totalPirates}`));
      console.log(chalk.yellow(`⏰ Registration Deadline: Round ${state.proposalDeadline}`));

      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' } })).return!;

      console.log(chalk.yellow(`📡 Registering as Pirate...`));

      await client.send.registerPirate({
        args: {
          sessionId: sessionID,
          payment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(participationFee)),
          }),
          mbrPayment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr,
            receiver: client.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        suppressLog: true,
      });

      console.log(chalk.green('✅ Registered Successfully!'));
      console.log(chalk.cyan(`🏴‍☠️ You are now a pirate in this game`));
    } catch (e: any) {
      handleAlgoError(e, 'Register as Pirate');
    }
  },

  reveal: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'PIRATE');
      const client = new PirateGameClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      const { sessId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'sessId',
          message: 'Enter SESSION ID:',
          validate: (i) => !isNaN(parseInt(i)) || 'Invalid',
        },
      ]);

      const sessionID = BigInt(sessId);
      const state = await client.state.box.gameState.value(sessionID);
      if (!state) throw new Error('Game state not found');

      const phaseLabel = PHASES[Number(state.phase)] || 'Unknown';

      console.log(chalk.cyan(`\n📊 Game Status:`));
      console.log(chalk.gray(`   Phase: ${phaseLabel}`));
      console.log(chalk.gray(`   Round: ${state.currentRound}`));
      console.log(chalk.gray(`   Pirates Alive: ${state.alivePirates}`));
      console.log(chalk.gray(`   Pot: ${state.pot} µAlgo`));

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What do you want to do?',
          choices: [
            { name: '🎮 Start Game (Close Registration)', value: 'startGame' },
            { name: '💰 Propose Distribution', value: 'propose' },
            { name: '🗳️ Vote on Proposal', value: 'vote' },
            { name: '⚙️ Execute Round', value: 'execute' },
            { name: '💵 Claim Winnings', value: 'claim' },
            { name: '⏱️ Timeout AFK Proposer', value: 'timeout' },
          ],
        },
      ]);

      if (action === 'startGame') {
        console.log(chalk.yellow('🎮 Starting game...'));
        await client.send.startGame({
          args: { sessionId: sessionID },
          sender: wallet.account!.addr,
        });
        console.log(chalk.green('✅ Game started! Round 0 begins.'));
      } 
      else if (action === 'propose') {
        console.log(chalk.cyan('\n💰 Distribution Builder'));
        console.log(chalk.gray(`Total pot to distribute: ${state.pot} µAlgo`));
        console.log(chalk.gray(`Total pirates: ${state.totalPirates}`));

        const distribution = Buffer.alloc(Number(state.totalPirates) * 8);
        let totalAssigned = 0n;

        for (let i = 0; i < Number(state.totalPirates); i++) {
          const { share } = await inquirer.prompt([
            {
              type: 'input',
              name: 'share',
              message: `Share for Pirate ${i} (µAlgo):`,
              default: '0',
              validate: (val) => !isNaN(parseInt(val)) || 'Invalid number',
            },
          ]);
          const shareAmount = BigInt(share);
          distribution.writeBigUInt64BE(shareAmount, i * 8);
          totalAssigned += shareAmount;
        }

        if (totalAssigned !== state.pot) {
          console.log(chalk.red(`❌ Error: Total assigned (${totalAssigned}) != Pot (${state.pot})`));
          return;
        }

        console.log(chalk.yellow('📡 Submitting proposal...'));
        await client.send.proposeDistribution({
          args: { sessionId: sessionID, distribution },
          sender: wallet.account!.addr,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        });
        console.log(chalk.green('✅ Proposal submitted!'));
      } 
      else if (action === 'vote') {
        const { voteChoice } = await inquirer.prompt([
          {
            type: 'list',
            name: 'voteChoice',
            message: 'Your vote:',
            choices: [
              { name: '✅ YES (Accept)', value: 1 },
              { name: '❌ NO (Reject)', value: 0 },
            ],
          },
        ]);

        const salt = new Uint8Array(32);
        crypto.getRandomValues(salt);
        const saltHex = Buffer.from(salt).toString('hex');
        console.log(chalk.bgRed.white(` ⚠️  SECRET SALT: ${saltHex} (SAVE IT!) `));

        const choiceBytes = algosdk.encodeUint64(voteChoice);
        const combined = new Uint8Array([...choiceBytes, ...salt]);
        const hash = new Uint8Array(sha256.array(combined));

        const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!;

        console.log(chalk.yellow('📡 Committing vote...'));
        await client.send.commitVote({
          args: {
            sessionId: sessionID,
            voteHash: hash,
            mbrPayment: await wallet.algorand.createTransaction.payment({
              sender: wallet.account!.addr,
              receiver: client.appAddress,
              amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
            }),
          },
          sender: wallet.account!.addr,
        });
        console.log(chalk.green('✅ Vote committed!'));

        const { revealNow } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'revealNow',
            message: 'Reveal vote now?',
            default: false,
          },
        ]);

        if (revealNow) {
          console.log(chalk.yellow('🔓 Revealing vote...'));
          await client.send.revealVote({
            args: { sessionId: sessionID, vote: BigInt(voteChoice), salt },
            sender: wallet.account!.addr,
          });
          console.log(chalk.green('✅ Vote revealed!'));
        }
      } 
      else if (action === 'execute') {
        console.log(chalk.yellow('⚙️ Executing round...'));
        await client.send.executeRound({
          args: { sessionId: sessionID },
          sender: wallet.account!.addr,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        });
        console.log(chalk.green('✅ Round executed!'));
      } 
      else if (action === 'claim') {
        console.log(chalk.yellow('💵 Claiming winnings...'));
        const result = await client.send.claimWinnings({
          args: { sessionId: sessionID },
          sender: wallet.account!.addr,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        });
        console.log(chalk.green(`🎉 Claimed ${result.return} µAlgo!`));
      } 
      else if (action === 'timeout') {
        console.log(chalk.yellow('⏱️ Calling timeout...'));
        await client.send.timeOut({
          args: { sessionId: sessionID },
          sender: wallet.account!.addr,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        });
        console.log(chalk.green('✅ AFK proposer eliminated!'));
      }
    } catch (e: any) {
      handleAlgoError(e, 'Game Action');
    }
  },

  status: async (wallet: WalletManager) => {
    try {
      const appId = await getAppId(wallet, 'PIRATE');
      const client = new PirateGameClient({
        algorand: wallet.algorand,
        appId,
        defaultSender: wallet.account!.addr,
      });

      console.log(chalk.gray('🔄 Fetching Data...'));
      const currentRound = await getCurrentRound(wallet);

      const totalSessions = Number((await client.state.global.getAll()).sessionIdCounter!);

      UI.printTitle('📊 DASHBOARD PIRATE GAME');
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
        const state = await client.state.box.gameState.value(sessionID);

        if (!state) continue;

        const phaseLabel = PHASES[Number(state.phase)] || 'Unknown';
        let statusIcon = '🏴‍☠️';
        if (state.phase === 4n) statusIcon = '🏆';
        else if (state.phase === 0n) statusIcon = '📝';

        console.log(chalk.white(`${statusIcon} ID: ${i} [${phaseLabel}]`));
        console.log(chalk.gray(`   Round: ${state.currentRound} | Pirates: ${state.alivePirates}/${state.totalPirates} | Pot: ${state.pot} µAlgo`));
        console.log(chalk.gray(`   Proposal Deadline: ${state.proposalDeadline} ${getRoundDiff(currentRound, state.proposalDeadline)}`));
        console.log(chalk.gray(`   Vote Deadline: ${state.voteDeadline} ${getRoundDiff(currentRound, state.voteDeadline)}`));
        console.log('');
      }
    } catch (e: any) {
      handleAlgoError(e, 'Status');
    }
  },
};
