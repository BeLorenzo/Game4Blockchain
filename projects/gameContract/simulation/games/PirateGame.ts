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
import { BaseDecisionSchema } from '../llm'
import {z} from "zod"

const PirateProposalSchema = BaseDecisionSchema.extend({
    distribution: z.array(z.coerce.number()) 
  });

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

  //Usato per registrare 
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


  private expandDistribution(shortDist: number[], totalPirates: number): number[] {
    const fullDist = new Array(totalPirates).fill(0);
    let shortIdx = 0;

    for (let i = 0; i < totalPirates; i++) {
        if (this.pirates[i].alive) {
            fullDist[i] = shortDist[shortIdx] || 0;
            shortIdx++;
        } else {
            fullDist[i] = 0; 
        }
    }
    return fullDist;
}



  //Fa ciclo di gioco
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

            const alivePirates = this.pirates.filter(p => p.alive);

            let attempts = 0;
            const maxAttempts = 5;
            let finalFullDistribution: number[] = [];
            let response = {
              choice: 1,
              reasoning: "Default greedy proposal",
              distribution: this.buildFallbackDistribution(Number(state.totalPirates), proposerIndex, Number(state.pot))
            };
            let errorFeedback = "";

            while(attempts < maxAttempts) {
              try {
                const prompt = this.buildProposerPrompt(proposer.agent, state, internalRound, proposerIndex)
                response = await proposer.agent.playRound(this.name, prompt, PirateProposalSchema)
                
                const shortDist = response.distribution || [];

                if (shortDist.length !== alivePirates.length) {
                    throw new Error(`L'array deve avere esattamente ${alivePirates.length} elementi (uno per ogni pirata VIVO). Tu ne hai messi ${shortDist.length}.`);
                }
                
                const sum = shortDist.reduce((a: number, b: number) => a + b, 0);
                if (Math.abs(sum - 100) > 10) {
                  throw new Error(`La somma delle percentuali è ${sum}%, ma deve essere almeno tra 90% e 110%.`);
                }

                finalFullDistribution = this.expandDistribution(shortDist, Number(state.totalPirates));
                const deadWithMoney = finalFullDistribution.filter((amt: number, idx: number) => !this.pirates[idx].alive && amt > 0);
                if (deadWithMoney.length > 0) {
                  throw new Error(`Hai assegnato denaro a pirati morti. Gli indici dei pirati morti devono avere 0.`);
                }
                break;
              } catch (e:any) {
                attempts++
                const currentDist = (response && response.distribution) ? JSON.stringify(response.distribution) : "null";
errorFeedback = `
[SYSTEM ERROR - ATTEMPT ${attempts}]:
Your last distribution was: ${currentDist}
Error Detail: ${e.message}

CORRECTION PROTOCOL:
1. Count the elements: must be EXACTLY ${state.totalPirates}.
2. Check the sum: sum(elements) must be EXACTLY 100.
3. Dead Pirates: Indices < ${proposerIndex} MUST be 0.
Current Status: ${this.pirates.map(p => `#${p.seniorityIndex}:${p.alive?'Alive':'DEAD'}`).join(', ')}
`;                console.warn(`[DEBUG] Proposta Pirate #${proposerIndex} respinta (Tentativo ${attempts}): ${e.message}`);
                
                if (attempts >= maxAttempts) {
                  console.error("❌ Max tentativi raggiunti. Forzo fallback.");
                  response = { 
                  choice: 1, 
                  distribution: this.buildFallbackDistribution(Number(state.totalPirates), proposerIndex, Number(state.pot)),
                  reasoning: "LLM failed all logic checks." 
                  };
                }
              }
            }


            const fullPercentages = this.expandDistribution(response.distribution, Number(state.totalPirates));

            const distributionBuffer = this.parseDistributionFromLLM(
                { ...response, distribution: fullPercentages }, 
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

                let vote = 0;

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
             const proposalAccepted = result === "WIN";
             
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
                
                // FIX 2: Pass role metadata via additionalData
                await pirate.agent.finalizeRound(
                    this.name, 
                    roundResult, 
                    roundProfit, 
                    sessionNumber, 
                    internalRound, // Use LOCAL internal round count
                    {
                      role: pirate.role,  // 'proposer' or 'voter'
                      proposalAccepted: proposalAccepted,
                    }
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
    
    // 1. Recuperiamo la proposta finale dal box dello smart contract
    const proposal = await this.appClient!.state.box.proposals.value(sessionId)
    if (!proposal) {
        console.log("⚠️ No proposal found. Nothing to claim.");
        return;
    }

    // 2. Parsiamo la distribuzione finale (array di BigInt)
    const state = await this.appClient!.state.box.gameState.value(sessionId)
    const finalAmounts = this.parseDistributionFromBytes(proposal.distribution, Number(state!.totalPirates));

    for (const pirate of this.pirates) {
      if (!pirate.alive) continue;

      // 3. Controlliamo quanto gli spetta
      const winnings = finalAmounts[pirate.seniorityIndex];

      if (winnings > 0n) {
        console.log(`💰 [${pirate.agent.name}] Claiming ${Number(winnings) / 1_000_000} ALGO...`);
        await this.safeSend(() => this.appClient!.send.claimWinnings({
          args: { sessionId },
          sender: pirate.agent.account.addr,
          signer: pirate.agent.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        }), `Claim ${pirate.agent.name}`);
      } else {
        // Se ha 0, evitiamo la chiamata e l'errore
        console.log(`ℹ️ [${pirate.agent.name}] has 0 ALGO assigned. Skipping claim to avoid contract error.`);
      }
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

  private buildFallbackDistribution(
  totalPirates: number,
  proposerIndex: number,
  pot: number
): number[] {
  const percentages = new Array(totalPirates).fill(0)
  percentages[proposerIndex] = 100
  return percentages
}


  // --- ROBUST PERCENTAGE PARSER ---
private parseDistributionFromLLM(
  response: {
    choice: number
    reasoning: string
    distribution?: number[]
  },
  totalPirates: number,
  pot: number,
  proposerIndex: number
): Uint8Array {

  const buffer = Buffer.alloc(totalPirates * 8)

  let percentages = response.distribution
  console.log(`Scelta: ${response.choice}`)
    console.log(`reasoning: ${response.reasoning}`)
      console.log(`distribuzione: ${response.distribution}`)
  console.log(`\n🎯 PARSING DISTRIBUTION FROM LLM STRUCTURED RESPONSE`)

  // 1️⃣ Validazione base
  if (!Array.isArray(percentages) || percentages.length !== totalPirates) {
    console.warn(`⚠️ Invalid or missing distribution. Using fallback.`)
    percentages = this.buildFallbackDistribution(totalPirates, proposerIndex, pot)
  }

  // 2️⃣ DEAD PIRATES → 0%
  for (let i = 0; i < totalPirates; i++) {
    if (!this.pirates[i].alive) {
      percentages[i] = 0
    }
  }

  // 3️⃣ Normalize to 100%
  const sum = percentages.reduce((a, b) => a + b, 0)
  if (sum <= 0) throw new Error("Invalid distribution sum")

  percentages = percentages.map(p => (p / sum) * 100)

  // 4️⃣ Convert to microALGOs
  const amounts: number[] = []
  percentages.forEach((pct, i) => {
    const amount = Math.floor((pct / 100) * pot)
    amounts.push(amount)
    buffer.writeBigUInt64BE(BigInt(amount), i * 8)
  })

  // 5️⃣ Fix rounding → proposer
  const allocated = amounts.reduce((a, b) => a + b, 0)
  const remainder = pot - allocated
  if (remainder > 0) {
    buffer.writeBigUInt64BE(
      buffer.readBigUInt64BE(proposerIndex * 8) + BigInt(remainder),
      proposerIndex * 8
    )
  }

  console.log(`✅ FINAL DISTRIBUTION (ALGO):`,
    amounts.map(a => (a / 1_000_000).toFixed(2))
  )

  return buffer
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

  private buildProposerPrompt(
  agent: Agent,
  state: any,
  round: number,
  proposerIndex: number,
  errorFeedback: string = "" // Aggiungi questo per passargli gli errori dei tentativi falliti
): string {
  const potAlgo = Number(state.pot) / 1_000_000;
  const alivePirates = this.pirates.filter(p => p.alive);
  const aliveCount = alivePirates.length;
  const votesNeeded = Math.ceil(aliveCount / 2);
  
  // Trova l'indice locale (quello che l'LLM deve usare nell'array corto)
  const localProposerIndex = alivePirates.findIndex(p => p.seniorityIndex === proposerIndex);

  const mappingString = alivePirates.map((p, i) => 
    `Index [${i}] -> Pirate #${p.seniorityIndex}${p.seniorityIndex === proposerIndex ? ' (YOU)' : ''}`
  ).join('\n');

  return `
You are ${agent.name}. 
Personality: ${agent.profile.personalityDescription}

=== PIRATE GAME – PROPOSAL PHASE (Round ${round}) ===

OBJECTIVE:
You are the CAPTAIN. Propose a distribution that PASSES (needs ${votesNeeded} YES votes, including yours) and maximizes your profit. 
If it fails, you DIE.

GAME DATA:
- Total pot: ${potAlgo} ALGO.
- Active Pirates (Alive): ${aliveCount}.
- Your Global Identity: Pirate #${proposerIndex}.

### IMPORTANT: ARRAY MAPPING (ONLY ${aliveCount} ELEMENTS)
Your "distribution" array MUST have exactly ${aliveCount} elements. 
Use this mapping to assign percentages:
${mappingString}

### STRATEGY:
- To pay YOURSELF, assign money to Index [${localProposerIndex}].
- To buy votes from others, assign money to their corresponding local indices.
- Global Indices lower than #${proposerIndex} are already DEAD and removed from this list. Do not worry about them.

### TECHNICAL REQUIREMENTS:
1. "distribution" array length: EXACTLY ${aliveCount}.
2. Sum of all elements: EXACTLY 100.
3. Format: JSON only.

${errorFeedback ? `\n⚠️ PREVIOUS ATTEMPT ERROR: ${errorFeedback}\n` : ''}

### RESPONSE FORMAT:
{
  "choice": 1,
  "distribution": [number, number, ...], 
  "reasoning": "Brief strategy explanation."
}

FINAL CHECK: Is your array length ${aliveCount}? If not, the game breaks.
`.trim();
}


  private buildVoterPrompt(
  agent: Agent,
  state: any,
  proposal: any,
  round: number
): string {
  const distribution = this.parseDistributionFromBytes(
    proposal.distribution,
    Number(state.totalPirates)
  )

  const me = this.pirates.find(p => p.agent.name === agent.name)!
  const myIndex = me.seniorityIndex
  const myShare = Number(distribution[myIndex]) / 1_000_000
  const entryCost = Number(this.participationAmount.microAlgos) / 1_000_000
  const netGain = myShare - entryCost

  const proposerIndex = Number(state.currentProposerIndex)
  const proposerShare =
    Number(distribution[proposerIndex]) / 1_000_000

  return `
You are ${agent.name}.
Personality: ${agent.profile.personalityDescription}

=== PIRATE GAME – VOTING PHASE (Round ${round}) ===

ROLE:
You are a VOTER. You must decide whether to accept or reject the captain's proposal.

GAME RULES (REMINDER):
- If the proposal PASSES:
  - The game ends.
  - You receive your allocated share.
- If the proposal FAILS:
  - The captain (pirate #${proposerIndex}) is eliminated.
  - A new captain will propose next round.
  - You may get a better deal later… or worse.

DEAD PIRATES CHECK:
- Pirates with index LOWER than ${proposerIndex} are DEAD.
- Dead pirates receive 0%.
- This proposal already respects that rule.

YOUR OFFER:
- You receive: ${myShare} ALGO
- Entry cost: ${entryCost} ALGO
- Net result if accepted: ${netGain.toFixed(2)} ALGO

CAPTAIN INCENTIVE:
- Captain receives: ${proposerShare} ALGO

DECISION GUIDELINES:
- Voting YES gives you a guaranteed outcome now.
- Voting NO kills the captain but risks uncertainty.
- Consider:
  - Is your net gain positive?
  - Is the captain being excessively greedy?
  - Would you likely do better if you become captain later?

PROPOSAL SUMMARY:
${distribution.map((amt, idx) => {
  const name = this.pirates.find(p => p.seniorityIndex === idx)?.agent.name
  return `- Pirate #${idx} (${name}): ${Number(amt) / 1_000_000} ALGO`
}).join('\n')}

RESPONSE FORMAT (JSON ONLY):
{
  "choice": 1 or 0,
  "reasoning": "Explain why you vote YES or NO based on risk, reward, and future expectations."
}
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
      await this.algorand.send.payment({ sender: spammer.addr, receiver: spammer.addr, amount: AlgoAmount.MicroAlgos(0), signer: spammer.signer, note: `spam-${i}-${Date.now()}` })
    }
  }
}
