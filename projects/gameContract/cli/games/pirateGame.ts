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
 * Helper to parse distribution from bytes (same logic as simulator).
 */
const parseDistributionFromBytes = (bytes: Uint8Array, totalPirates: number): bigint[] => {
  const result: bigint[] = [];
  const buffer = Buffer.from(bytes);
  for (let i = 0; i < totalPirates; i++) {
    result.push(buffer.readBigUInt64BE(i * 8));
  }
  return result;
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
      
      const myPirateKey = await getPirateKey(client, sessionID, wallet.account!.addr.toString());
      let myData;
      try {
        myData = await client.state.box.pirates.value(myPirateKey);
      } catch (e) {
        console.log(chalk.red('❌ You are not registered in this game!'));
        return;
      }

      if (myData!.seniorityIndex !== state.currentProposerIndex) {
        console.log(chalk.red(`❌ You are not the current proposer!`));
        console.log(chalk.yellow(`Current proposer should be Pirate #${state.currentProposerIndex}`));
        return;
      }

      const distribution = Buffer.alloc(Number(state.totalPirates) * 8);
      let totalAssigned = 0n;
      console.log(chalk.yellow('\n💡 Enter distribution for each pirate:'));

      for (let i = 0; i < Number(state.totalPirates); i++) {
        const isAlive = await isPirateAlive(client, sessionID, i);
        if (!isAlive) {
          console.log(chalk.gray(`☠️  Pirate #${i} is dead. Skipping (0 µAlgo).`));
          distribution.writeBigUInt64BE(0n, i * 8);
          continue; 
        }

        const { share } = await inquirer.prompt([{
          type: 'input', name: 'share', message: `Share for Pirate #${i} (µAlgo):`, default: i === Number(myData!.seniorityIndex) ? state.pot.toString() : '0'
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

      const state = await client.state.box.gameState.value(sessionID);
      if (!state) throw new Error("State not found");     

      const proposal = await client.state.box.proposals.value(sessionID);
      if (!proposal) {
        console.log(chalk.red('❌ No proposal found yet!'));
        return;
      }

      const distribution = parseDistributionFromBytes(proposal.distribution, Number(state.totalPirates));
      const sessionConfig = await client.state.box.gameSessions.value(sessionID);
      const entryCost = Number(sessionConfig!.participation);

      console.log(chalk.cyan('\n📋 CURRENT PROPOSAL:'));
      console.log(chalk.gray('─'.repeat(50)));

      const myPirateKey = await getPirateKey(client, sessionID, wallet.account!.addr.toString());
      let myData;
      try {
        myData = await client.state.box.pirates.value(myPirateKey);
      } catch (e) {
        console.log(chalk.red('❌ You are not registered in this game!'));
        return;
      }

      const myIndex = Number(myData!.seniorityIndex);
      const myShare = Number(distribution[myIndex]) / 1_000_000;
      const netGain = myShare - (entryCost / 1_000_000);

      for (let i = 0; i < Number(state.totalPirates); i++) {
        const amount = Number(distribution[i]) / 1_000_000;
        const isMe = i === myIndex;
        const prefix = isMe ? chalk.green('👉 YOU') : '  ';
        const color = isMe ? chalk.green.bold : chalk.gray;
        console.log(color(`${prefix} Pirate #${i}: ${amount.toFixed(2)} ALGO`));
      }

      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.yellow(`💰 Your share: ${myShare.toFixed(2)} ALGO`));
      console.log(chalk.yellow(`📥 Entry cost: ${(entryCost / 1_000_000).toFixed(2)} ALGO`));

      const gainColor = netGain >= 0 ? chalk.green : chalk.red;
      const gainPrefix = netGain >= 0 ? '+' : '';
      console.log(gainColor(`💵 Net result: ${gainPrefix}${netGain.toFixed(2)} ALGO`));
      console.log('');

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
      UI.separator();

      if (totalSessions === 0) { console.log('No games.'); return; }

      // Show last 5 sessions
      for (let i = totalSessions - 1; i >= Math.max(0, totalSessions - 5); i--) {
        const sessionID = BigInt(i);
        const [config, state] = await Promise.all([
             client.state.box.gameSessions.value(sessionID),
             client.state.box.gameState.value(sessionID)
        ]);
        if (!state || !config) continue;

        let phaseLabel = '';
        let phaseColor = chalk.gray;
        let phaseInfo = '';

        if (state.phase === 4n) {
          phaseLabel = '🏁 FINISHED';
          phaseColor = chalk.green;
          phaseInfo = 'Game ended! Use "Claim Winnings" to collect your share.';
        } 
        else if (currentRound < config.startAt) {
          phaseLabel = '⏳ REGISTRATION';
          phaseColor = chalk.gray;
          phaseInfo = `Game starts at round ${config.startAt} ${getRoundDiff(currentRound, config.startAt)}`;
        } 
        else if (state.phase === 0n || state.phase === 1n) {
          // Fase di PROPOSTA
          if (currentRound > config.endCommitAt) {
            phaseLabel = '⚠️  PROPOSER AFK (TIMEOUT)';
            phaseColor = chalk.red;
            phaseInfo = 'Commit deadline passed without a proposal! Use "Timeout" to kill the proposer.';
          } else {
            phaseLabel = '📋 PROPOSAL OPEN';
            phaseColor = chalk.yellow;
            phaseInfo = `Proposer #${state.currentProposerIndex} can submit. Deadline: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`;
          }
        } 
        else if (state.phase === 2n) {
          // Fase di VOTO (Commit)
          if (currentRound > config.endCommitAt) {
            phaseLabel = '⚠️  VOTING STUCK (TIMEOUT)';
            phaseColor = chalk.red;
            phaseInfo = 'Voting deadline passed! Use "Execute Round" or "Timeout" to proceed.';
          } else {
            phaseLabel = '🗳️  VOTE COMMIT OPEN';
            phaseColor = chalk.yellow;
            phaseInfo = `Vote deadline: ${config.endCommitAt} ${getRoundDiff(currentRound, config.endCommitAt)}`;
          }
        } 
        else if (state.phase === 3n) {
          // Fase di REVEAL
          if (currentRound > config.endRevealAt) {
            phaseLabel = '⚠️  NEEDS EXECUTE';
            phaseColor = chalk.red;
            phaseInfo = 'Reveal deadline passed! Use "Execute Round" to resolve the round.';
          } else {
            phaseLabel = '🔓 REVEAL OPEN';
            phaseColor = chalk.cyan; // Magari cambiamo colore per distinguerlo dal commit
            phaseInfo = `Reveal deadline: ${config.endRevealAt} ${getRoundDiff(currentRound, config.endRevealAt)}`;
          }
        }

        console.log(chalk.cyan(`\n🔹 Session ID: ${i}`));
        console.log(phaseColor(`   ${phaseLabel} | Game Round: ${state.currentRound}`));
        console.log(chalk.gray(`   Alive: ${state.alivePirates}/${state.totalPirates} | Pot: ${Number(state.pot) / 1_000_000} ALGO`));
        console.log(chalk.gray(`   ${phaseInfo}`));

        if (state.phase === 2n || state.phase === 3n) {
          try {
            const proposal = await client.state.box.proposals.value(sessionID);
            if (proposal) {
              const distribution = parseDistributionFromBytes(proposal.distribution, Number(state.totalPirates));
              console.log(chalk.gray(`   💡 Current proposal (Pirate → ALGO):`));
              for (let j = 0; j < Math.min(5, Number(state.totalPirates)); j++) {
                const amount = Number(distribution[j]) / 1_000_000;
                console.log(chalk.gray(`      #${j}: ${amount.toFixed(2)}`));
              }
              if (Number(state.totalPirates) > 5) {
                console.log(chalk.gray(`      ... and ${Number(state.totalPirates) - 5} more`));
              }
            }
          } catch (e) { /* proposal might not exist yet */ }
        }
      }
    } catch (e: any) { handleAlgoError(e, 'Status'); }
  },
};

/**
 * Helper to get appropriate color based on phase and timing
 */
function getPhaseColor(phase: number, currentRound: bigint, config: any): typeof chalk {
  if (phase === 4) return chalk.green;
  if (phase === 0) return chalk.gray;
  
  // Check if we're past deadlines
  if (phase === 1 && currentRound > config.endCommitAt) return chalk.red;
  if ((phase === 2 || phase === 3) && currentRound > config.endRevealAt) return chalk.red;
  
  return chalk.yellow;
}

/**
 * Helper to get pirate box key (must match contract logic)
 */
async function getPirateKey(client: PirateGameClient, sessionId: bigint, address: string): Promise<Uint8Array> {
  const crypto = await import('crypto');
  const sessionIdBytes = Buffer.alloc(8);
  sessionIdBytes.writeBigUInt64BE(sessionId);
  const addressBytes = algosdk.decodeAddress(address).publicKey;
  return new Uint8Array(
    crypto.createHash('sha256')
      .update(Buffer.concat([sessionIdBytes, Buffer.from(addressBytes)]))
      .digest()
  );
}

async function isPirateAlive(client: PirateGameClient, sessionId: bigint, pirateIndex: number): Promise<boolean> {
  try {
    const pirateListBytes = await client.state.box.pirateList.value(sessionId);
    const offset = pirateIndex * 32;
    const pubKeyBytes = pirateListBytes!.slice(offset, offset + 32);
    const pirateAddress = algosdk.encodeAddress(pubKeyBytes);
    const pirateKey = await getPirateKey(client, sessionId, pirateAddress);
    const pirateData = await client.state.box.pirates.value(pirateKey);
    return pirateData!.alive;
  } catch (error) {
    return false;
  }
}
