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

/**
 * Helper to initialize the Pirate Game Client.
 */
const getClient = async (wallet: WalletManager) => {
  const appId = await getAppId(wallet, 'PIRATE');
  return new PirateGameClient({
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
    type: 'input', name: 'sessId', message: 'Enter SESSION ID:',
    validate: (i) => !isNaN(parseInt(i)) || 'Invalid Number',
  }]);
  return BigInt(answers.sessId);
};

export const PirateGameModule: IGameModule = {
  id: 'PIRATE',
  name: '🏴‍☠️ Pirate Game',

  // Flat Menu: All actions visible immediately
  getAvailableActions: (): GameAction[] => [
    { name: '🚀 Deploy Contract', value: 'deploy' },
    { name: '🆕 Create Session', value: 'create', separator: true },
    { name: '✍️  Register (Join)', value: 'join' },
    { name: '💰 Propose Distribution', value: 'propose' },
    { name: '🗳️  Vote (Commit)', value: 'vote' },
    { name: '🔓 Reveal Vote', value: 'revealVote' },
    { name: '⚙️  Execute Round', value: 'execute' },
    { name: '⏱️  Timeout AFK', value: 'timeout' },
    { name: '💵 Claim Winnings', value: 'claim', separator: true },
    { name: '📊 Dashboard', value: 'status', separator: true },
  ],

  /**
   * Deploys the Pirate Game Factory contract.
   * Initializes it and funds the MBR.
   */
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
        onUpdate: 'append', onSchemaBreak: 'append', suppressLog: true,
      });
      if (['create', 'replace'].includes(result.operationPerformed)) {
        console.log(chalk.yellow('📝 Initializing...'));
        await appClient.send.initialize({ args: { gameType: 'PIRATE' } });
        
        // Fund the contract
        await wallet.algorand.send.payment({
          amount: AlgoAmount.Algos(1),
          sender: wallet.account.addr,
          receiver: appClient.appAddress,
        });
      }
      console.log(chalk.green(`✅ DEPLOYMENT SUCCESSFUL! App ID: ${appClient.appId}`));
    } catch (e: any) { handleAlgoError(e, 'Deploy'); }
  },

  /**
   * Creates a new Pirate Game session.
   * Defines the maximum number of pirates and round durations.
   */
  create: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const answers = await inquirer.prompt([
        { type: 'input', name: 'participation', message: 'Fee (µAlgo)?', default: '1000000' },
        { type: 'input', name: 'maxPirates', message: 'Max Pirates (3-20)?', default: '5' },
        { type: 'input', name: 'startDelay', message: 'Start delay (rounds)?', default: '1' },
        { type: 'input', name: 'commit', message: 'Commit duration (rounds)?', default: '50' },
        { type: 'input', name: 'reveal', message: 'Reveal duration (rounds)?', default: '50' },
      ]);

      const currentRound = await getCurrentRound(wallet);
      const startAt = currentRound + BigInt(answers.startDelay);
      const endCommit = startAt + BigInt(answers.commit);
      const endReveal = endCommit + BigInt(answers.reveal);
      
      console.log(chalk.yellow('⏳ Calculating Cost...'));
      const mbrResult = await client.send.getRequiredMbr({ args: { command: 'newGame' }, suppressLog: true });
      
      const result = await client.send.createSession({
        args: {
          config: { startAt, endCommitAt: endCommit, endRevealAt: endReveal, participation: BigInt(answers.participation) }, 
          mbrPayment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(Number(mbrResult.return)),
          }),
          maxPirates: BigInt(answers.maxPirates),
        }, suppressLog: true,
      });
      console.log(chalk.green(`✅ Session Created! ID: ${result.return}`));
    } catch (e: any) { handleAlgoError(e, 'Create Session'); }
  },

  /**
   * Registers a player as a pirate in the session.
   * First come, first served regarding seniority.
   */
  join: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      const sessionConfig = await client.state.box.gameSessions.value(sessionID);
      const joinMbr = (await client.send.getRequiredMbr({ args: { command: 'join' }, suppressLog: true, })).return!;

      console.log(chalk.yellow(`📡 Registering... Fee: ${sessionConfig!.participation} µAlgo`));
      await client.send.registerPirate({
        args: {
          sessionId: sessionID,
          payment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(Number(sessionConfig!.participation)),
          }),
          mbrPayment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        }, suppressLog: true,
      });
      console.log(chalk.green('✅ You are now a pirate!'));
    } catch (e: any) { handleAlgoError(e, 'Join'); }
  },

  /**
   * The current Senior Pirate proposes how to split the pot.
   * The proposal is a byte array where each 8 bytes represents the amount for a specific pirate index.
   */
  propose: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      const state = await client.state.box.gameState.value(sessionID);
      if (!state) throw new Error("State not found");

      

      console.log(chalk.cyan(`\n💰 Pot: ${state.pot} µAlgo | Pirates: ${state.totalPirates}`));
      const distribution = Buffer.alloc(Number(state.totalPirates) * 8);
      let totalAssigned = 0n;

      for (let i = 0; i < Number(state.totalPirates); i++) {
        const { share } = await inquirer.prompt([{
          type: 'input', name: 'share', message: `Share for Pirate #${i} (µAlgo):`, default: '0'
        }]);
        const shareAmount = BigInt(share);
        distribution.writeBigUInt64BE(shareAmount, i * 8);
        totalAssigned += shareAmount;
      }

      if (totalAssigned !== state.pot) {
        console.log(chalk.red(`❌ Sum (${totalAssigned}) != Pot (${state.pot})`));
        return;
      }

      console.log(chalk.yellow('📡 Submitting proposal...'));
      await client.send.proposeDistribution({
        args: { sessionId: sessionID, distribution },
        coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(3000),
        suppressLog: true,
      });
      console.log(chalk.green('✅ Proposal submitted!'));
    } catch (e: any) { handleAlgoError(e, 'Propose'); }
  },

  /**
   * Pirates vote on the current proposal.
   * Uses Commit-Reveal: Vote is hashed with a salt.
   */
  vote: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      const { voteChoice } = await inquirer.prompt([{
        type: 'list', name: 'voteChoice', message: 'Your vote:',
        choices: [{ name: '✅ YES', value: 1 }, { name: '❌ NO', value: 0 }],
      }]);

      

      const salt = new Uint8Array(32);
      crypto.getRandomValues(salt);
      console.log(chalk.bgRed.white(` ⚠️  SAVE SALT: ${Buffer.from(salt).toString('hex')} `));

      const choiceBytes = algosdk.encodeUint64(voteChoice);
      const combined = new Uint8Array([...choiceBytes, ...salt]);
      const hash = new Uint8Array(sha256.array(combined));

      const commitMbr = (await client.send.getRequiredMbr({ args: { command: 'commitVote' }, suppressLog: true, } )).return!;
      
      console.log(chalk.yellow('📡 Committing vote...'));
      await client.send.commitVote({
        args: {
          sessionId: sessionID, voteHash: hash,
          mbrPayment: await wallet.algorand.createTransaction.payment({
            sender: wallet.account!.addr, receiver: client.appAddress, amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
          }),
        },
        suppressLog: true,
      });
      console.log(chalk.green('✅ Vote committed!'));
    } catch (e: any) { handleAlgoError(e, 'Vote'); }
  },

  /**
   * Reveals the committed vote.
   */
  revealVote: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      const { voteChoice, saltHex } = await inquirer.prompt([
        { type: 'list', name: 'voteChoice', message: 'What did you vote?', choices: [{ name: 'YES', value: 1 }, { name: 'NO', value: 0 }] },
        { type: 'input', name: 'saltHex', message: 'Your Secret Salt (Hex):' }
      ]);

      console.log(chalk.yellow('🔓 Revealing...'));
      await client.send.revealVote({
        args: { sessionId: sessionID, vote: BigInt(voteChoice), salt: new Uint8Array(Buffer.from(saltHex, 'hex')) },
        suppressLog: true,
      });
      console.log(chalk.green('✅ Revealed!'));
    } catch (e: any) { handleAlgoError(e, 'Reveal'); }
  },

  /**
   * Executes the round logic after all votes are revealed (or deadlines passed).
   * Checks majority:
   * - If passed: Game Ends, Proposal is accepted.
   * - If failed: Proposer is eliminated, Next round starts.
   */
  execute: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      console.log(chalk.yellow('⚙️ Executing round logic...'));
      await client.send.executeRound({
        args: { sessionId: sessionID },
        coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(3000),
        suppressLog: true,
      });
      console.log(chalk.green('✅ Round executed! Check Dashboard for results.'));
    } catch (e: any) { handleAlgoError(e, 'Execute'); }
  },

  /**
   * Triggers a timeout if the current proposer is AFK or votes are stuck.
   */
  timeout: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      console.log(chalk.yellow('⏱️ Triggering Timeout...'));
      await client.send.timeOut({
        args: { sessionId: sessionID },
        coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(3000),
      });
      console.log(chalk.green('✅ AFK Proposer Eliminated.'));
    } catch (e: any) { handleAlgoError(e, 'Timeout'); }
  },

  /**
   * Claims winnings if the game is in the 'Finished' phase.
   */
  claim: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const sessionID = await askSessionId();
      console.log(chalk.yellow('💵 Claiming...'));
      const result = await client.send.claimWinnings({
        args: { sessionId: sessionID },
        coverAppCallInnerTransactionFees: true, maxFee: AlgoAmount.MicroAlgo(3000),
        suppressLog: true,
      });
      console.log(chalk.green(`🎉 Claimed ${result.return} µAlgo!`));
    } catch (e: any) { handleAlgoError(e, 'Claim'); }
  },

  /**
   * Displays the game status, current phase, and deadlines.
   */
  status: async (wallet: WalletManager) => {
    try {
      const client = await getClient(wallet);
      const currentRound = await getCurrentRound(wallet);
      const totalSessions = Number((await client.state.global.getAll()).sessionIdCounter!);

      UI.printTitle('📊 DASHBOARD PIRATE GAME');
      console.log(chalk.white(`🌍 Current Round: ${chalk.bold(currentRound)}`));
      
      if (totalSessions === 0) { console.log('No games.'); return; }

      // Show last 5 sessions
      for (let i = totalSessions - 1; i >= Math.max(0, totalSessions - 5); i--) {
        const sessionID = BigInt(i);
        const [config, state] = await Promise.all([
             client.state.box.gameSessions.value(sessionID),
             client.state.box.gameState.value(sessionID)
        ]);
        if (!state || !config) continue;

        const phaseLabel = PHASES[Number(state.phase)] || 'Unknown';
        console.log(chalk.cyan(`🔹 ID: ${i} | Phase: ${phaseLabel} | Round: ${state.currentRound}`));
        console.log(chalk.gray(`   Alive: ${state.alivePirates}/${state.totalPirates} | Pot: ${state.pot}`));
        
        if (state.phase === 0n) {
             console.log(chalk.yellow(`   Start Game: ${config.startAt} ${getRoundDiff(currentRound, config.startAt)}`));
        } else if (state.phase === 1n) {
             console.log(chalk.red(`   Deadline Proposal: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`));
        } else if (state.phase === 2n) {
             console.log(chalk.red(`   Deadline Vote: ${config.endRevealAt} ${getRoundDiff(currentRound, config.endRevealAt)}`));
        }
        console.log('');
      }
    } catch (e: any) { handleAlgoError(e, 'Status'); }
  },
};
