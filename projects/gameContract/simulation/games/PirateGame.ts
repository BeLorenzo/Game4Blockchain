/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import algosdk from 'algosdk'
import { PirateGameClient, PirateGameFactory } from '../../smart_contracts/artifacts/pirateGame/PirateGameClient'
import { Agent } from '../Agent'
import { IGameAdapter } from './IGameAdapter'

interface RoundSecret {
  vote: number
  salt: string
}

interface PirateInfo {
  agent: Agent
  seniorityIndex: number
  alive: boolean
  finalized: boolean
  role?: 'proposer' | 'voter'
}

export class PirateGame implements IGameAdapter {
  readonly name = 'PirateGame'

  private algorand = AlgorandClient.defaultLocalNet()
  private factory: PirateGameFactory | null = null
  private appClient: PirateGameClient | null = null
  private participationAmount = AlgoAmount.Algos(10)
  private pirates: PirateInfo[] = []
  private roundSecrets: Map<string, RoundSecret> = new Map()
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null
  private currentInternalRound = 0

  // Tempi adattati per la simulazione
  private durationParams = {
    warmUp: 50n,
    commitPhase: 70n,
    revealPhase: 50n,
  }

  // Set per tracciare le azioni già eseguite nel round corrente (Idempotenza)
  private actionsDone: Set<string> = new Set();

  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(PirateGameFactory, {
      defaultSender: admin.account.addr,
      defaultSigner: admin.signer,
    })

    const { appClient } = await this.factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
    })

    await this.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, AlgoAmount.Algos(5))

    this.appClient = appClient
    console.log(`${this.name} deployed. AppID: ${appClient.appId}`)
    return BigInt(appClient.appId)
  }

  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error('Deploy first!')

    this.pirates = []
    this.roundSecrets.clear()
    this.currentInternalRound = 0
    this.actionsDone.clear()

    const status = (await this.algorand.client.algod.status().do()) as any
    const currentRound = BigInt(status['lastRound'])

    const startAt = currentRound + this.durationParams.warmUp
    const endCommitAt = startAt + this.durationParams.commitPhase
    const endRevealAt = endCommitAt + this.durationParams.revealPhase

    this.sessionConfig = { startAt, endCommitAt, endRevealAt }

    const mbr = (await this.appClient.send.getRequiredMbr({ args: { command: 'newGame' } })).return!

    const mbrPayment = await this.algorand.createTransaction.payment({
      sender: dealer.account.addr,
      receiver: this.appClient.appAddress,
      amount: AlgoAmount.MicroAlgos(mbr),
    })

    const result = await this.appClient.send.createSession({
      args: {
        config: {
          startAt,
          endCommitAt,
          endRevealAt,
          participation: this.participationAmount.microAlgos,
        },
        mbrPayment,
        maxPirates: 20n,
      },
      sender: dealer.account.addr,
      signer: dealer.signer,
    })

    console.log(`Session ${result.return} created. Registration until round ${startAt}`)
    return result.return!
  }

  async play_Commit(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    console.log(`\n--- PHASE 1: REGISTRATION ---`)
    const joinMbr = (await this.appClient!.send.getRequiredMbr({ args: { command: 'join' } })).return!

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      
      await this.safeSend(() => this.appClient!.send.registerPirate({
        args: {
          sessionId,
          payment: this.algorand.createTransaction.payment({
            sender: agent.account.addr,
            receiver: this.appClient!.appAddress,
            amount: this.participationAmount,
          }),
          mbrPayment: this.algorand.createTransaction.payment({
            sender: agent.account.addr,
            receiver: this.appClient!.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: agent.account.addr,
        signer: agent.signer,
      }), "Register Pirate");

      this.pirates.push({
        agent,
        seniorityIndex: i,
        alive: true,
        finalized: false,
      })
      console.log(`[${agent.name}] Registered as Pirate #${i}`)
    }

    await this.waitUntilRound(this.sessionConfig!.startAt + 1n)
    console.log(`\n🏴‍☠️ Game Started! ${agents.length} pirates ready to negotiate...`)
  }

  async play_Reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    // No-op
  }

  async resolve(dealer: Agent, sessionId: bigint, sessionNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- MULTI-ROUND RESOLUTION (Session ${sessionNumber}) ---`)

    let gameOngoing = true
    let internalRound = 1 
    let currentProposalDistribution: bigint[] = []

    while (gameOngoing) {
      const state = await this.appClient!.state.box.gameState.value(sessionId)
      let config = await this.appClient!.state.box.gameSessions.value(sessionId)
      if (!state || !config) throw new Error('Game state/config not found')

      // Sync Alive Status
      for (const pirate of this.pirates) {
          if (!pirate.alive) continue; 
          const pirateKey = this.getPirateKeySync(sessionId, pirate.agent.account.addr.toString())
          try {
            const pirateData = await this.appClient!.state.box.pirates.value(pirateKey)
            if (pirateData && !pirateData.alive) {
               console.log(`💀 [SYNC] Pirate #${pirate.seniorityIndex} (${pirate.agent.name}) is CONFIRMED DEAD on-chain.`)
               pirate.alive = false
            }
          } catch (e) { /* ignore */ }
      }

      // Reset finalized for alive pirates (new round context)
      this.pirates.forEach(p => { if (p.alive) p.finalized = false })

      console.log(`\n┌─────────────────────────────────────`)
      console.log(`│ 🔄 Internal Round ${internalRound} | Phase: ${this.getPhaseName(Number(state.phase))}`)
      console.log(`│ 👥 Alive: ${state.alivePirates}/${state.totalPirates}`)
      console.log(`│ 💰 Pot: ${Number(state.pot) / 1_000_000} ALGO`)
      console.log(`└─────────────────────────────────────`)

      if (state.phase === 4n) {
        console.log('\n🎉 GAME FINISHED! Moving to claims...')
        gameOngoing = false
        break
      }

      // === PHASE 1: PROPOSAL ===
      if (state.phase === 1n || (state.phase === 0n && internalRound === 1)) {
        const proposerIndex = Number(state.currentProposerIndex)
        const actionKey = `PROPOSE_R${internalRound}_P${proposerIndex}`;

        if (!this.actionsDone.has(actionKey)) {
            const proposer = this.pirates.find((p) => p.seniorityIndex === proposerIndex)

            if (!proposer || !proposer.alive) {
                console.error(`Proposer #${proposerIndex} not found or dead!`)
                break
            }
            proposer.role = 'proposer'

            console.log(`\n📋 PROPOSAL PHASE`)
            console.log(`Proposer: ${proposer.agent.name} (Pirate #${proposerIndex})`)

            const prompt = this.buildProposerPrompt(proposer.agent, state, internalRound, proposerIndex)
            const decision = await proposer.agent.playRound(this.name, prompt)

            // USIAMO IL NUOVO METODO DI PARSING LIBERO
            const distributionBuffer = this.parseDistribution(
                decision.reasoning, 
                Number(state.totalPirates), 
                Number(state.pot), 
                proposerIndex
            )
            currentProposalDistribution = this.parseDistributionFromBytes(distributionBuffer, Number(state.totalPirates))

            console.log(`\n💡 ${proposer.agent.name} proposes:`)
            this.logDistribution(distributionBuffer, Number(state.totalPirates))

            await this.safeSend(() => this.appClient!.send.proposeDistribution({
                    args: { sessionId, distribution: distributionBuffer },
                    sender: proposer.agent.account.addr,
                    signer: proposer.agent.signer,
                    coverAppCallInnerTransactionFees: true,
                    maxFee: AlgoAmount.MicroAlgo(3000),
                }), "Propose Distribution");
            
            this.actionsDone.add(actionKey); 
            
            const updatedConfig = await this.appClient!.state.box.gameSessions.value(sessionId)
            if (updatedConfig) config = updatedConfig
        }
      }

      // === PHASE 2: VOTE COMMIT ===
      const freshState = await this.appClient!.state.box.gameState.value(sessionId)
      if (freshState && freshState.phase === 2n) {
        const phaseKey = `COMMIT_R${internalRound}`;
        if (!this.actionsDone.has(phaseKey)) {
            console.log(`\n🗳️  VOTE COMMIT PHASE`)
            const commitMbr = (await this.appClient!.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!
            const proposal = await this.appClient!.state.box.proposals.value(sessionId)

            for (const pirate of this.pirates) {
                if (!pirate.alive) continue

                let vote = 0; // Default NO

                // AUTO-VOTE YES FOR PROPOSER
                if (pirate.seniorityIndex === Number(state.currentProposerIndex)) {
                    console.log(`[${pirate.agent.name}] is Proposer -> Auto-voting YES (1)`);
                    vote = 1;
                    pirate.role = 'proposer';
                } else {
                    pirate.role = 'voter';
                    const prompt = this.buildVoterPrompt(pirate.agent, freshState, proposal, internalRound)
                    const decision = await pirate.agent.playRound(this.name, prompt)
                    vote = decision.choice === 1 ? 1 : 0
                }

                const salt = crypto.randomBytes(16).toString('hex')
                this.roundSecrets.set(pirate.agent.account.addr.toString(), { vote, salt })
                
                await this.safeSend(() => this.appClient!.send.commitVote({
                    args: {
                    sessionId,
                    voteHash: new Uint8Array(this.getHash(vote, salt)),
                    mbrPayment: this.algorand.createTransaction.payment({
                        sender: pirate.agent.account.addr,
                        receiver: this.appClient!.appAddress,
                        amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
                    }),
                    },
                    sender: pirate.agent.account.addr,
                    signer: pirate.agent.signer,
                }), `Vote ${pirate.agent.name}`);
                
                const label = vote === 1 ? "YES" : "NO";
                console.log(`[${pirate.agent.name}] Committed vote (${label})`)
            }
            this.actionsDone.add(phaseKey);
            await this.waitUntilRound(config.endCommitAt + 1n)
        }
      }

      // === PHASE 3: VOTE REVEAL ===
      const stateReveal = await this.appClient!.state.box.gameState.value(sessionId)
      if (stateReveal && (stateReveal.phase === 3n || stateReveal.phase === 2n)) {
        const phaseKey = `REVEAL_R${internalRound}`;
        if (!this.actionsDone.has(phaseKey)) {
            console.log(`\n🔓 VOTE REVEAL PHASE`)
            for (const pirate of this.pirates) {
                if (!pirate.alive) continue
                const secret = this.roundSecrets.get(pirate.agent.account.addr.toString())
                if (!secret) continue
                
                await this.safeSend(() => this.appClient!.send.revealVote({
                    args: {
                        sessionId,
                        vote: BigInt(secret.vote),
                        salt: Buffer.from(secret.salt),
                    },
                    sender: pirate.agent.account.addr,
                    signer: pirate.agent.signer,
                }), `Reveal ${pirate.agent.name}`);
                
                console.log(`[${pirate.agent.name}] Revealed: ${secret.vote === 1 ? 'YES' : 'NO'}`)
            }
            this.actionsDone.add(phaseKey);
            await this.waitUntilRound(config.endRevealAt + 1n)
        }
      }

      // === EXECUTE ROUND ===
      console.log(`\n⚙️  EXECUTING ROUND...`)
      await this.safeSend(() => this.appClient!.send.executeRound({
        args: { sessionId },
        sender: dealer.account.addr,
        signer: dealer.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      }), "Execute Round");

      // === RECORDING HISTORY ===
      const postState = await this.appClient!.state.box.gameState.value(sessionId)
      if (postState) {
        let result = "PENDING";
        if (postState.phase === 4n) result = "WIN"; 
        else if (postState.phase === 1n && Number(postState.currentRound) > Number(state.currentRound)) {
             result = "NEXT_ROUND";
        }

        if (result !== "PENDING") {
             for (const pirate of this.pirates) {
                if (pirate.finalized) continue; // Already saved
                if (!pirate.alive && result !== "WIN") continue; // Already dead

                let roundProfit = 0;
                let roundResult = "SURVIVED";

                if (result === "WIN") {
                    const share = Number(currentProposalDistribution[pirate.seniorityIndex] || 0n);
                    const entry = Number(this.participationAmount.microAlgos);
                    roundProfit = (share - entry) / 1_000_000;
                    roundResult = "WIN";
                } else {
                     const pirateKey = this.getPirateKeySync(sessionId, pirate.agent.account.addr.toString())
                     const pData = await this.appClient!.state.box.pirates.value(pirateKey)
                     if (pData && !pData.alive) {
                         roundResult = "ELIMINATED";
                         roundProfit = -Number(this.participationAmount.microAlgos) / 1_000_000;
                         pirate.alive = false; 
                     } else {
                         roundResult = "SURVIVED"; 
                         roundProfit = 0;
                     }
                }
                
                await pirate.agent.finalizeRound(
                    this.name, 
                    roundResult, 
                    roundProfit, 
                    sessionNumber, 
                    internalRound // Use LOCAL internal round count
                );
                pirate.finalized = true;
            }
            if (Number(postState.currentRound) > Number(state.currentRound)) {
                 internalRound = Number(postState.currentRound) + 1;
            }
        }
        
        if (postState.phase === 4n) gameOngoing = false;
      }

      if (internalRound > 30) break
    }
  }

  async play_Claim(agents: Agent[], sessionId: bigint, sessionNumber: number): Promise<void> {
    console.log('\n--- PHASE 4: CLAIM WINNINGS (Payout) ---')
    for (const pirate of this.pirates) {
      if (!pirate.alive) continue;
      await this.safeSend(() => this.appClient!.send.claimWinnings({
        args: { sessionId },
        sender: pirate.agent.account.addr,
        signer: pirate.agent.signer,
        coverAppCallInnerTransactionFees: true,
        maxFee: AlgoAmount.MicroAlgo(3000),
      }), `Claim ${pirate.agent.name}`);
    }
  }

  // === HELPER METHODS ===

  private async safeSend(action: () => Promise<any>, label: string) {
      try {
          await action();
      } catch (e: any) {
          if (e.message && (e.message.includes('transaction already in ledger') || e.message.includes('already'))) {
              console.log(`⚠️  [SafeSend] ${label} already on chain. Continuing.`);
          } else {
              console.error(`❌ [SafeSend] Error in ${label}:`, e.message);
          }
      }
  }

  private getPirateKeySync(sessionId: bigint, address: string): Uint8Array {
    const sessionIdBytes = Buffer.alloc(8)
    sessionIdBytes.writeBigUInt64BE(sessionId)
    const addressBytes = algosdk.decodeAddress(address).publicKey
    return new Uint8Array(
      crypto.createHash('sha256').update(Buffer.concat([sessionIdBytes, Buffer.from(addressBytes)])).digest(),
    )
  }

  // --- NEW SMART PARSER ---
  private parseDistribution(reasoning: string, totalPirates: number, pot: number, proposerIndex: number): Uint8Array {
    const buffer = Buffer.alloc(totalPirates * 8)
    let parsedAmounts: number[] = []

    // 1. Regex flessibile per trovare array di numeri
    const match = reasoning.match(/\[([\d,\s_.]+)\]/)
    
    if (match) {
      const content = match[1];
      parsedAmounts = content.split(',')
        .map(s => s.trim().replace(/_/g, '')) 
        .map(Number)
        .filter(n => !isNaN(n));
    }

    // 2. Fallback se l'LLM ha fallito
    if (parsedAmounts.length !== totalPirates) {
        console.warn(`⚠️ LLM Output Invalid (Got ${parsedAmounts.length} items). Using Fallback.`);
        parsedAmounts = new Array(totalPirates).fill(0);
        const alivePirates = this.pirates.filter(p => p.alive);
        const needed = Math.ceil((alivePirates.length + 1) / 2) - 1; 
        let bought = 0;
        
        for (let i = 0; i < totalPirates; i++) {
            if (i !== proposerIndex && this.pirates[i].alive && bought < needed) {
                parsedAmounts[i] = 1_000_000; // 1 ALGO bribe
                bought++;
            }
        }
    }

    // 3. MATH FIXER
    // Force 0 to dead
    for (let i = 0; i < totalPirates; i++) {
        if (!this.pirates[i].alive) parsedAmounts[i] = 0;
    }

    // Fix sum
    const currentSum = parsedAmounts.reduce((a, b) => a + b, 0);
    const diff = pot - currentSum;
    const proposerShare = (parsedAmounts[proposerIndex] || 0) + diff;
    
    if (proposerShare < 0) {
        // Se il proponente va in negativo, resetta tutto
        console.warn("⚠️ Negative Proposer Share! Resetting to full greedy.");
        parsedAmounts.fill(0);
        parsedAmounts[proposerIndex] = pot;
    } else {
        parsedAmounts[proposerIndex] = proposerShare;
    }

    // Write to buffer
    parsedAmounts.forEach((amt, idx) => {
        buffer.writeBigUInt64BE(BigInt(Math.floor(amt)), idx * 8);
    });

    return buffer;
  }

  private parseDistributionFromBytes(distributionBytes: Uint8Array, totalPirates: number): bigint[] {
    const result: bigint[] = []
    const buffer = Buffer.from(distributionBytes)
    for (let i = 0; i < totalPirates; i++) {
      result.push(buffer.readBigUInt64BE(i * 8))
    }
    return result
  }

  private logDistribution(distribution: Uint8Array, totalPirates: number) {
    const buffer = Buffer.from(distribution)
    for (let i = 0; i < totalPirates; i++) {
      const amount = buffer.readBigUInt64BE(i * 8)
      const pirate = this.pirates.find(p => p.seniorityIndex === i)
      const status = pirate?.alive ? '🟢' : '💀'
      console.log(`  ${status} Pirate #${i} (${pirate?.agent.name}): ${Number(amount) / 1_000_000} ALGO`)
    }
  }

  private getHash(choice: number, salt: string): Uint8Array {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return new Uint8Array(crypto.createHash('sha256').update(Buffer.concat([b, Buffer.from(salt)])).digest())
  }

  private getPhaseName(phase: number): string {
    const names = ['Registration', 'Proposal', 'VoteCommit', 'VoteReveal', 'Finished', 'Cancelled']
    return names[phase] || 'Unknown'
  }

  // --- NEW PROMPTS ---

  private buildProposerPrompt(agent: Agent, state: any, round: number, proposerIndex: number): string {
    const entryCost = Number(this.participationAmount.microAlgos) / 1_000_000
    const potAlgo = Number(state.pot) / 1_000_000
    const votesNeeded = Math.ceil((Number(state.alivePirates) + 1) / 2)
    const votesToBuy = votesNeeded - 1

    let piratesStatus = "PIRATES STATUS:\n";
    this.pirates.forEach(p => {
        const status = p.alive ? "🟢 ALIVE" : "💀 DEAD (Must get 0)";
        const youTag = p.seniorityIndex === proposerIndex ? " <--- YOU (Automatic YES)" : "";
        piratesStatus += `- Pirate #${p.seniorityIndex} (${p.agent.name}): ${status}${youTag}\n`;
    });

    return `
You are ${agent.name}. 
Your Personality: ${agent.profile.personalityDescription}

=== 🏴‍☠️ PIRATE GAME: PROPOSAL PHASE (Round ${round}) ===
You are the CAPTAIN (Proposer). You have FULL CONTROL over the loot distribution.

${piratesStatus}

💰 CONTEXT:
- Total Pot: ${potAlgo} ALGO
- Votes required: ${votesNeeded} (You + ${votesToBuy} others)

STRATEGY:
1. **Build a Coalition:** Pick exactly ${votesToBuy} alive pirates to be your allies.
2. **Buy their votes:** Offer them enough (e.g. ${entryCost} ALGO or slightly more/less depending on your greed).
3. **Punish Enemies:** Give 0 to everyone else.
4. **Keep the rest:** The remaining ALGO goes to YOU.

TASK:
Output the exact distribution array in MicroAlgos (1 ALGO = 1,000,000 MicroAlgos).
Example for 3 pirates: [8000000, 1000000, 1000000]

Respond with JSON: 
{"choice": 1, "reasoning": "I will pay Pirate #X and #Y because...", "distribution": [amount0, amount1, amount2, ...]}
`.trim()
  }

  private buildVoterPrompt(agent: Agent, state: any, proposal: any, round: number): string {
    const distribution = this.parseDistributionFromBytes(proposal!.distribution, Number(state.totalPirates))
    const myPirateInfo = this.pirates.find((p) => p.agent.name === agent.name)
    const myShare = myPirateInfo ? Number(distribution[myPirateInfo.seniorityIndex]) / 1_000_000 : 0
    const entryCost = Number(this.participationAmount.microAlgos) / 1_000_000
    const netProfit = myShare - entryCost

    const currentProposerIdx = Number(state.currentProposerIndex);
    const proposer = this.pirates.find(p => p.seniorityIndex === currentProposerIdx)
    const proposerShare = Number(distribution[currentProposerIdx]) / 1_000_000

    let nextProposerName = "None (Game Over if rejected)";
    const sortedPirates = [...this.pirates].sort((a, b) => a.seniorityIndex - b.seniorityIndex);
    const nextAlive = sortedPirates.find(p => p.alive && p.seniorityIndex > currentProposerIdx);
    if (nextAlive) nextProposerName = `Pirate #${nextAlive.seniorityIndex} (${nextAlive.agent.name})`;

    return `
You are ${agent.name}.
Your Personality: ${agent.profile.personalityDescription}

=== 🏴‍☠️ PIRATE GAME: VOTING PHASE (Round ${round}) ===
Current Captain (${proposer?.agent.name}) has made an offer.

💰 YOUR OFFER:
- You receive: **${myShare} ALGO**
- Net Profit: ${netProfit.toFixed(2)} ALGO

⚖️ FAIRNESS CHECK:
- Captain takes: ${proposerShare} ALGO
- You take: ${myShare} ALGO
- Difference: Captain gets ${(proposerShare/(myShare||1)).toFixed(1)}x more.

PROPOSAL DETAILS:
${distribution.map((amt, idx) => {
    const pName = this.pirates.find(p => p.seniorityIndex === idx)?.agent.name || "Unknown";
    const isMe = idx === myPirateInfo?.seniorityIndex ? " <--- YOU" : "";
    const isCap = idx === currentProposerIdx ? " [CAPTAIN]" : "";
    return `- Pirate #${idx} (${pName}): ${Number(amt) / 1_000_000} ALGO${isMe}${isCap}`;
}).join('\n')}

🔮 LOOK AHEAD:
If REJECTED: Current Captain dies. Next Captain is **${nextProposerName}**.
Will they offer you more?

Vote YES (1) or NO (0).
If the offer is an insult (huge gap between Captain and you), consider voting NO to punish greed.

Respond with JSON: {"choice": 1, "reasoning": "..."}
`.trim()
  }

  private async waitUntilRound(targetRound: bigint) {
    const status = (await this.algorand.client.algod.status().do()) as any
    const currentRound = BigInt(status['lastRound'])
    if (currentRound >= targetRound) return
    const blocks = Number(targetRound - currentRound)
    const spammer = await this.algorand.account.random()
    await this.algorand.account.ensureFundedFromEnvironment(spammer.addr, AlgoAmount.Algos(1))
    for (let i = 0; i < blocks; i++) {
      await this.algorand.send.payment({ sender: spammer.addr, receiver: spammer.addr, amount: AlgoAmount.MicroAlgos(0), signer: spammer.signer, note: `spam` })
    }
  }
}
