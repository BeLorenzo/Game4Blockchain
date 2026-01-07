/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { PirateGameClient, PirateGameFactory } from '../../smart_contracts/artifacts/pirateGame/PirateGameClient'
import { Agent } from '../Agent'
import { IGameAdapter } from './IGameAdapter'
import algosdk from 'algosdk'

interface RoundSecret {
  vote: number
  salt: string
}

interface PirateInfo {
  agent: Agent
  seniorityIndex: number
  alive: boolean
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

  // Tempi adattati per la simulazione (più veloci per i test)
  private durationParams = {
    warmUp: 50n,
    commitPhase: 70n, // Tempo per Proposta + Voto
    revealPhase: 50n,
  }

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

  async play_Commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    console.log(`\n--- PHASE 1: REGISTRATION ---`)

    const joinMbr = (await this.appClient!.send.getRequiredMbr({ args: { command: 'join' } })).return!

    // Register all pirates
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]

      await this.appClient!.send.registerPirate({
        args: {
          sessionId,
          payment: await this.algorand.createTransaction.payment({
            sender: agent.account.addr,
            receiver: this.appClient!.appAddress,
            amount: this.participationAmount,
          }),
          mbrPayment: await this.algorand.createTransaction.payment({
            sender: agent.account.addr,
            receiver: this.appClient!.appAddress,
            amount: AlgoAmount.MicroAlgos(Number(joinMbr)),
          }),
        },
        sender: agent.account.addr,
        signer: agent.signer,
      })

      this.pirates.push({
        agent,
        seniorityIndex: i,
        alive: true,
      })

      console.log(`[${agent.name}] Registered as Pirate #${i}`)
    }

    // Wait for game to start
    await this.waitUntilRound(this.sessionConfig!.startAt + 1n)
    console.log(`\n🏴‍☠️ Game Started! ${agents.length} pirates ready to negotiate...`)
  }

  async play_Reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    // Multi-round resolution happens in resolve()
  }

  async resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- MULTI-ROUND RESOLUTION ---`)

    let gameOngoing = true
    let internalRound = 0

    while (gameOngoing) {
      // Refresh state at the start of loop
      const state = await this.appClient!.state.box.gameState.value(sessionId)
      if (!state) throw new Error('Game state not found')

      // Refresh config (timers might have changed if round advanced)
      let config = await this.appClient!.state.box.gameSessions.value(sessionId)
      if (!config) throw new Error('Session config not found')

      // CRITICAL: Sync pirate alive status from blockchain
      await this.syncPirateStatus(sessionId)

      console.log(`\n┌─────────────────────────────────────`)
      console.log(`│ 🔄 Round ${internalRound} | Phase: ${this.getPhaseName(Number(state.phase))}`)
      console.log(`│ 👥 Alive: ${state.alivePirates}/${state.totalPirates}`)
      console.log(`│ 💰 Pot: ${Number(state.pot) / 1_000_000} ALGO`)
      
      // Show alive pirates
      const alivePiratesList = this.pirates
        .filter(p => p.alive)
        .map(p => `#${p.seniorityIndex}(${p.agent.name})`)
        .join(', ')
      console.log(`│ 🟢 Alive Pirates: ${alivePiratesList}`)
      
      console.log(`└─────────────────────────────────────`)

      // Check if game finished
      if (state.phase === 4n) {
        console.log('\n🎉 GAME FINISHED! Moving to claims...')
        gameOngoing = false
        break
      }

      // === PHASE 1: PROPOSAL ===
      if (state.phase === 1n || (state.phase === 0n && internalRound === 0)) {
        const proposerIndex = Number(state.currentProposerIndex)
        const proposer = this.pirates.find((p) => p.seniorityIndex === proposerIndex)

        if (!proposer || !proposer.alive) {
          console.error(`❌ Proposer #${proposerIndex} not found or dead! This should not happen.`)
          break
        }

        console.log(`\n📋 PROPOSAL PHASE`)
        console.log(`Proposer: ${proposer.agent.name} (Pirate #${proposerIndex})`)

        // Build prompt for proposer with alive status
        const prompt = this.buildProposerPrompt(proposer.agent, state, internalRound, proposerIndex)
        const decision = await proposer.agent.playRound(this.name, prompt)

        // Parse distribution from reasoning
        const distribution = this.parseDistribution(
            decision.reasoning, 
            Number(state.totalPirates), 
            Number(state.pot), 
            proposerIndex
        )

        console.log(`\n💡 ${proposer.agent.name} proposes:`)
        this.logDistribution(distribution, Number(state.totalPirates))

        // Submit proposal
        try {
            await this.appClient!.send.proposeDistribution({
            args: { sessionId, distribution: Buffer.from(distribution) },
            sender: proposer.agent.account.addr,
            signer: proposer.agent.signer,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgo(3000),
            })
            
            // Force fetch updated config to get the correct deadlines
            const updatedConfig = await this.appClient!.state.box.gameSessions.value(sessionId)
            if (updatedConfig) config = updatedConfig

        } catch (e: any) {
            console.error("❌ Proposal failed:", e.message)
        }
      }

      // === PHASE 2: VOTE COMMIT ===
      const freshState = await this.appClient!.state.box.gameState.value(sessionId)
      
      if (freshState && freshState.phase === 2n) {
        console.log(`\n🗳️  VOTE COMMIT PHASE`)

        const commitMbr = (await this.appClient!.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!
        const proposal = await this.appClient!.state.box.proposals.value(sessionId)

        // ONLY alive pirates vote
        const alivePirates = this.pirates.filter(p => p.alive)
        console.log(`Voting pirates: ${alivePirates.map(p => p.agent.name).join(', ')}`)

        for (const pirate of alivePirates) {
          const prompt = this.buildVoterPrompt(pirate.agent, freshState, proposal, internalRound)
          const decision = await pirate.agent.playRound(this.name, prompt)

          const vote = decision.choice === 1 ? 1 : 0
          const salt = crypto.randomBytes(16).toString('hex')

          this.roundSecrets.set(pirate.agent.account.addr.toString(), { vote, salt })

          const hash = this.getHash(vote, salt)

          try {
            await this.appClient!.send.commitVote({
              args: {
                sessionId,
                voteHash: new Uint8Array(hash),
                mbrPayment: await this.algorand.createTransaction.payment({
                  sender: pirate.agent.account.addr,
                  receiver: this.appClient!.appAddress,
                  amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
                }),
              },
              sender: pirate.agent.account.addr,
              signer: pirate.agent.signer,
            })
            console.log(`[${pirate.agent.name}] Committed vote`)
          } catch (e: any) {
            console.error(`❌ [${pirate.agent.name}] Vote commit failed:`, e.message)
          }
        }

        await this.waitUntilRound(config.endCommitAt + 1n)
      }

      // === PHASE 3: VOTE REVEAL ===
      const stateReveal = await this.appClient!.state.box.gameState.value(sessionId)
      
      if (stateReveal && (stateReveal.phase === 3n || stateReveal.phase === 2n)) {
        console.log(`\n🔓 VOTE REVEAL PHASE`)

        // ONLY alive pirates reveal
        const alivePirates = this.pirates.filter(p => p.alive)

        for (const pirate of alivePirates) {
          const secret = this.roundSecrets.get(pirate.agent.account.addr.toString())
          if (!secret) {
            console.log(`⚠️  [${pirate.agent.name}] No secret found, skipping`)
            continue
          }

          try {
            await this.appClient!.send.revealVote({
              args: {
                sessionId,
                vote: BigInt(secret.vote),
                salt: Buffer.from(secret.salt),
              },
              sender: pirate.agent.account.addr,
              signer: pirate.agent.signer,
            })

            const voteLabel = secret.vote === 1 ? '✅ YES' : '❌ NO'
            console.log(`[${pirate.agent.name}] Revealed: ${voteLabel}`)
          } catch (e: any) {
            console.error(`❌ [${pirate.agent.name}] Reveal failed:`, e.message)
          }
        }
        
        await this.waitUntilRound(config.endRevealAt + 1n)
      }

      // === EXECUTE ROUND ===
      console.log(`\n⚙️  EXECUTING ROUND...`)

      try {
        await this.appClient!.send.executeRound({
          args: { sessionId },
          sender: dealer.account.addr,
          signer: dealer.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        })
        
        console.log('✅ Round executed successfully')
      } catch (e: any) {
        console.error('❌ Execute error:', e.message)
      }

      // CRITICAL: Sync status AFTER executeRound to detect eliminations
      await this.syncPirateStatus(sessionId)

      // Refresh data to see if game is over
      const postExecState = await this.appClient!.state.box.gameState.value(sessionId)
      if (postExecState) {
        if (postExecState.phase === 4n) {
          console.log('\n✅ Proposal ACCEPTED! Game ending...')
          gameOngoing = false
        } else if (postExecState.phase === 1n) {
          console.log(`\n🔄 Proposal REJECTED! New proposer: Pirate #${postExecState.currentProposerIndex}`)
        }
      }
      
      internalRound++
      if (internalRound > 20) {
        console.error('⚠️  Safety limit reached (20 rounds), breaking loop')
        break
      }
    }
  }

  /**
   * CRITICAL: Syncs local pirate.alive status with blockchain state
   * This must be called after executeRound() to detect eliminations
   */
  private async syncPirateStatus(sessionId: bigint): Promise<void> {
    for (const pirate of this.pirates) {
      // Skip already dead pirates (no resurrection)
      if (!pirate.alive) continue

      try {
        // Build the correct key to query the pirate box
        const pirateKey = this.getPirateKeySync(sessionId, pirate.agent.account.addr.toString())
        const pirateData = await this.appClient!.state.box.pirates.value(pirateKey)
        
        if (pirateData && !pirateData.alive) {
          console.log(`💀 [SYNC] Pirate #${pirate.seniorityIndex} (${pirate.agent.name}) ELIMINATED`)
          pirate.alive = false
        }
      } catch (e) {
        // Box might not exist or other error - assume alive if we can't confirm death
      }
    }
  }

  /**
   * Synchronous version of getPirateKey (no async needed for hash)
   */
  private getPirateKeySync(sessionId: bigint, address: string): Uint8Array {
    const sessionIdBytes = Buffer.alloc(8)
    sessionIdBytes.writeBigUInt64BE(sessionId)
    
    // The address from account.addr is already a base58 string
    // We need to decode it to bytes for the contract key
    const addressBytes = algosdk.decodeAddress(address).publicKey
    
    return new Uint8Array(
      crypto.createHash('sha256').update(Buffer.concat([sessionIdBytes, Buffer.from(addressBytes)])).digest(),
    )
  }

  async play_Claim(agents: Agent[], sessionId: bigint, internalRound: number): Promise<void> {
    console.log('\n--- PHASE 4: CLAIM WINNINGS ---')

    for (const pirate of this.pirates) {
      let outcome = 'LOSS'
      let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000

      try {
        const result = await this.appClient!.send.claimWinnings({
          args: { sessionId },
          sender: pirate.agent.account.addr,
          signer: pirate.agent.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        console.log(
          `${pirate.agent.name}: \x1b[32m${outcome} (${netProfitAlgo >= 0 ? '+' : ''}${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`,
        )
      } catch (e: any) {
        if (e.message && e.message.includes('No winnings')) {
          console.log(`${pirate.agent.name}: \x1b[31mLOSS (Eliminated or no share)\x1b[0m`)
        }
      }

      pirate.agent.finalizeRound(this.name, outcome, netProfitAlgo, Number(sessionId), internalRound)
    }
  }

  // === HELPER METHODS ===

  private buildVoterPrompt(agent: Agent, state: any, proposal: any, round: number): string {
    const distribution = this.parseDistributionFromBytes(proposal!.distribution, Number(state.totalPirates))
    
    // Find this agent's share
    const myPirateInfo = this.pirates.find((p) => p.agent.name === agent.name)
    const myShare = myPirateInfo ? Number(distribution[myPirateInfo.seniorityIndex]) / 1_000_000 : 0
    const entryCost = Number(this.participationAmount.microAlgos) / 1_000_000
    const netProfit = myShare - entryCost

    const gameRules = `
GAME: Pirate Game - VOTING
A distribution has been proposed. Vote YES or NO.

💰 FINANCIAL STATUS:
- Entry Fee Paid: ${entryCost} ALGO
- OFFERED SHARE: ${myShare} ALGO
- NET RESULT if accepted: ${netProfit.toFixed(2)} ALGO

PROPOSED DISTRIBUTION:
${distribution.map((amt, idx) => {
  const pirate = this.pirates.find(p => p.seniorityIndex === idx)
  const status = pirate?.alive ? '🟢' : '💀'
  return `${status} Pirate #${idx}: ${Number(amt) / 1_000_000} ALGO`
}).join('\n')}

VOTES NEEDED TO PASS: ${Math.ceil((Number(state.alivePirates) + 1) / 2)}
ALIVE VOTERS: ${Number(state.alivePirates)}
`.trim()

    const hint = `
STRATEGIC CONSIDERATIONS:
- Consider your Net Result. Are you accepting a massive loss?
- If the offer is insulting (huge loss for you, huge gain for proposer), you might vote NO to punish them, even if you risk getting 0.
- "Fairness" implies getting at least close to your money back (${entryCost} ALGO).
- However, if you vote NO and are eliminated/get 0 next round, a small loss is better than a total loss.
- Note: 💀 Dead pirates' allocations are wasted/burned.

DECISION MATRIX:
- YES: You lock in ${netProfit.toFixed(2)} ALGO (Accept the result).
- NO: You gamble. Proposer dies. Next proposal might be better OR you might get 0.
`.trim()

    const personality = agent.profile.personalityDescription
    const parameters = agent.getProfileSummary()
    const lessons = agent.getLessonsLearned(this.name)
    const recentMoves = agent.getRecentHistory(this.name, 3)
    const mentalState = agent.getMentalState()

    return `
You are ${agent.name}.

═══════════════════════════════════════════════════════════
${gameRules}

${hint}
═══════════════════════════════════════════════════════════

YOUR PERSONALITY:
${personality}

YOUR PARAMETERS:
${parameters}

═══════════════════════════════════════════════════════════

${lessons}

YOUR RECENT MOVES:
${recentMoves}

MENTAL STATE: ${mentalState}

═══════════════════════════════════════════════════════════

Vote YES (choice: 1) or NO (choice: 0).
Explain your reasoning regarding the NET PROFIT/LOSS.

Respond with JSON: {"choice": <0 or 1>, "reasoning": "<your explanation>"}
`.trim()
  }

  private buildProposerPrompt(agent: Agent, state: any, round: number, proposerIndex: number): string {
    const entryCost = Number(this.participationAmount.microAlgos) / 1_000_000
    const potAlgo = Number(state.pot) / 1_000_000
    const votesNeeded = Math.ceil((Number(state.alivePirates) + 1) / 2)
    const votesToBuy = votesNeeded - 1

    // Build pirate status with CLEAR alive/dead markers
    let piratesStatus = "PIRATES STATUS:\n";
    this.pirates.forEach(p => {
        const status = p.alive ? "🟢 ALIVE (Can vote)" : "💀 DEAD (Eliminated - GIVE THEM 0!)";
        const youTag = p.seniorityIndex === proposerIndex ? " <--- YOU" : "";
        piratesStatus += `- Pirate #${p.seniorityIndex} (${p.agent.name}): ${status}${youTag}\n`;
    });

    const gameRules = `
GAME: Pirate Game (Sequential Bargaining)
You are the PROPOSER this round (Pirate #${proposerIndex}).

${piratesStatus}

💰 FINANCIAL CONTEXT (CRITICAL):
- Every pirate paid **${entryCost} ALGO** to enter this session (Entry Fee).
- The Total Pot to split is **${potAlgo} ALGO**.
- If you offer a pirate significantly less than ${entryCost} ALGO, they suffer a **NET LOSS**.
- Pirates with high 'Fairness' focus or 'Tit-for-Tat' strategy will likely vote NO to punish you if your offer results in a loss for them.

RULES:
- You must propose how to split the pot among ${state.totalPirates} pirates.
- ⚠️ CRITICAL: Dead pirates (💀) CANNOT VOTE and should receive 0. Giving them money is wasteful!
- You need a strict majority of **${votesNeeded} votes** from ALIVE pirates (including your own automatic YES).
- If PASSES: Distribution happens, game ends.
- If FAILS: You are ELIMINATED and lose your ${entryCost} ALGO fee.
`.trim()

    const hint = `
STRATEGIC GUIDE:
1. **Identify Voters:** Only ALIVE pirates (🟢) can vote. Count them carefully!
2. **Secure the Coalition:** You need to "buy" ${votesToBuy} other ALIVE pirates' votes.
3. **Pricing the Vote:**
   - **Safe Strategy:** Offer coalition partners close to break-even (${entryCost} ALGO).
   - **Risky Strategy:** Offer partial recovery (e.g., ${entryCost / 2} ALGO). Some might accept, others will kill you.
4. **Dead Pirates:** Give 0 to all 💀 pirates. They can't vote anyway, so don't waste money on them!
5. **The Others (alive but not in coalition):** You can give them 0 or small amounts. They'll vote NO, but if your coalition holds, you win.

WARNING:
Don't be too greedy or you'll be eliminated and lose everything!
`.trim()

    const personality = agent.profile.personalityDescription
    const parameters = agent.getProfileSummary()
    const lessons = agent.getLessonsLearned(this.name)
    const recentMoves = agent.getRecentHistory(this.name, 3)
    const mentalState = agent.getMentalState()

    return `
You are ${agent.name}.

═══════════════════════════════════════════════════════════
${gameRules}

${hint}
═══════════════════════════════════════════════════════════

YOUR PERSONALITY:
${personality}

YOUR PARAMETERS:
${parameters}

═══════════════════════════════════════════════════════════

${lessons}

YOUR RECENT MOVES:
${recentMoves}

MENTAL STATE: ${mentalState}

═══════════════════════════════════════════════════════════

Create your proposal.
IMPORTANT: Output a distribution array of exactly ${state.totalPirates} numbers (MicroAlgos).
Index 0 = Share for Pirate #0
...
Index ${proposerIndex} = YOUR SHARE

REMEMBER: Give 0 to all DEAD pirates (💀)!

Sum must equal exactly ${state.pot}.

Respond with JSON: {"choice": 1, "reasoning": "<strategy> Distribution: [amt0, amt1, ...]"}
`.trim()
  }

  private parseDistribution(reasoning: string, totalPirates: number, pot: number, proposerIndex: number): Uint8Array {
    const match = reasoning.match(/Distribution:\s*\[([\d,\s]+)\]/)
    
    if (match) {
      const amounts = match[1].split(',').map((s) => s.trim()).map(Number)
      if (amounts.length === totalPirates) {
        const sum = amounts.reduce((a, b) => a + b, 0)
        if (Math.abs(sum - pot) < 1000) {
          const buffer = Buffer.alloc(totalPirates * 8)
          amounts.forEach((amt, idx) => {
            buffer.writeBigUInt64BE(BigInt(amt), idx * 8)
          })
          return buffer
        }
      }
    }

    console.warn('⚠️  Could not parse distribution from reasoning, using FALLBACK')
    const buffer = Buffer.alloc(totalPirates * 8)
    
    // Fallback: Give most to proposer, small amounts to alive pirates only
    const alivePirates = this.pirates.filter(p => p.alive)
    const othersShare = Math.floor(pot * 0.1 / (alivePirates.length - 1)) // 10% split
    const proposerShare = pot - (othersShare * (alivePirates.length - 1))
    
    for (let i = 0; i < totalPirates; i++) {
      const pirate = this.pirates.find(p => p.seniorityIndex === i)
      if (!pirate || !pirate.alive) {
        // Dead pirate gets 0
        buffer.writeBigUInt64BE(0n, i * 8)
      } else if (i === proposerIndex) {
        buffer.writeBigUInt64BE(BigInt(proposerShare), i * 8)
      } else {
        buffer.writeBigUInt64BE(BigInt(othersShare), i * 8)
      }
    }
    
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
      console.log(`  ${status} Pirate #${i}: ${Number(amount) / 1_000_000} ALGO`)
    }
  }

  private getHash(choice: number, salt: string): Uint8Array {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return new Uint8Array(
      crypto.createHash('sha256').update(Buffer.concat([b, Buffer.from(salt)])).digest(),
    )
  }



  private getPhaseName(phase: number): string {
    const names = ['Registration', 'Proposal', 'VoteCommit', 'VoteReveal', 'Finished', 'Cancelled']
    return names[phase] || 'Unknown'
  }



  private async waitUntilRound(targetRound: bigint) {
    const status = (await this.algorand.client.algod.status().do()) as any
    const currentRound = BigInt(status['lastRound'])
    if (currentRound >= targetRound) return

    const blocksToSpam = Number(targetRound - currentRound)
    const spammer = await this.algorand.account.random()
    await this.algorand.account.ensureFundedFromEnvironment(spammer.addr, AlgoAmount.Algos(1))

    for (let i = 0; i < blocksToSpam; i++) {
      await this.algorand.send.payment({
        sender: spammer.addr,
        receiver: spammer.addr,
        amount: AlgoAmount.MicroAlgos(0),
        signer: spammer.signer,
        note: `spam-${i}-${Date.now()}`,
      })
    }
  }
}
