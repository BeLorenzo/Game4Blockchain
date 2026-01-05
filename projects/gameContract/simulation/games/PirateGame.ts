/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { decodeAddress } from 'algosdk'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { PirateGameClient, PirateGameFactory } from '../../smart_contracts/artifacts/pirateGame/PirateGameClient'
import { Agent } from '../Agent'
import { askLLM } from '../llm'
import { IGameAdapter } from './IGameAdapter'

interface RoundSecret {
  vote: number
  salt: string
}

interface SessionConfig {
  startAt: bigint
  proposalDeadline: bigint
  voteDeadline: bigint
  revealDeadline: bigint
}

export class PirateGame implements IGameAdapter {
  readonly name = 'PirateGame'

  private algorand = AlgorandClient.defaultLocalNet()
  private factory: PirateGameFactory | null = null
  private appClient: PirateGameClient | null = null
  private participationAmount = AlgoAmount.Algos(10)
  private roundSecrets: Map<string, RoundSecret> = new Map()
  private sessionConfig: SessionConfig | null = null
  private pirateMap: Map<string, number> = new Map() // addr -> seniorityIndex

  private durationParams = {
    registrationWindow: 30n,
    roundDuration: 50n,
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

    const status = await this.algorand.client.algod.status().do()
    const currentRound = BigInt(status['lastRound'])

    const startAt = currentRound + 10n
    const endCommitAt = startAt + 1000n
    const endRevealAt = endCommitAt + 1000n

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
        maxPirates: BigInt(7),
        roundDuration: this.durationParams.roundDuration,
      },
      sender: dealer.account.addr,
      signer: dealer.signer,
    })

    const sessionId = result.return!
    const state = await this.appClient.state.box.gameState.value(sessionId)

    this.sessionConfig = {
      startAt: state!.proposalDeadline - this.durationParams.registrationWindow,
      proposalDeadline: state!.proposalDeadline,
      voteDeadline: state!.voteDeadline,
      revealDeadline: state!.revealDeadline,
    }

    console.log(`PirateGame session ${sessionId} created. Registration starts at round ${this.sessionConfig.startAt}`)
    await this.waitUntilRound(this.sessionConfig.startAt)

    return sessionId
  }

  async play_Commit(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    if (!this.sessionConfig) throw new Error('Session not initialized')

    console.log('\n--- PHASE: REGISTRATION ---')

    const joinMbr = (await this.appClient!.send.getRequiredMbr({ args: { command: 'join' } })).return!

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
            amount: AlgoAmount.MicroAlgos(joinMbr),
          }),
        },
        sender: agent.account.addr,
        signer: agent.signer,
      })

      this.pirateMap.set(agent.account.addr.toString(), i)
      console.log(`[${agent.name}] Registered as Pirate #${i}`)
    }

    await this.waitUntilRound(this.sessionConfig.proposalDeadline + 1n)

    console.log('\n--- GAME START ---')
    await this.appClient!.send.startGame({
      args: { sessionId },
      sender: agents[0].account.addr,
      signer: agents[0].signer,
    })
  }

  async play_Reveal(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    if (!this.sessionConfig) return

    let gamePhase = 1
    let gameRound = 0

    while (gamePhase !== 4) {
      const state = await this.appClient!.state.box.gameState.value(sessionId)
      gamePhase = Number(state!.phase)
      gameRound = Number(state!.currentRound)

      if (gamePhase === 4) break

      if (gamePhase === 1) {
        console.log(`\n--- ROUND ${gameRound}: PROPOSAL ---`)
        
        const proposerIndex = Number(state!.currentProposerIndex)
        const proposer = agents.find((a) => this.pirateMap.get(a.account.addr.toString()) === proposerIndex)!

        const distribution = await this.askForProposal(proposer, agents, sessionId, gameRound)

        console.log(`[${proposer.name}] Proposed:`, distribution.map((d) => `${(d / 1_000_000).toFixed(1)}A`).join(', '))

        const distributionBuffer = Buffer.alloc(distribution.length * 8)
        distribution.forEach((d, i) => distributionBuffer.writeBigUInt64BE(BigInt(d), i * 8))

        await this.appClient!.send.proposeDistribution({
          args: { sessionId, distribution: distributionBuffer },
          sender: proposer.account.addr,
          signer: proposer.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        })

        continue
      }

      if (gamePhase === 2) {
        console.log(`\n--- ROUND ${gameRound}: VOTING ---`)

        const proposal = await this.appClient!.state.box.proposals.value(sessionId)
        const distributionBuffer = Buffer.from(proposal!.distribution)
        const distribution: number[] = []

        for (let i = 0; i < agents.length; i++) {
          distribution.push(Number(distributionBuffer.readBigUInt64BE(i * 8)))
        }

        const proposerIndex = Number(proposal!.proposer)
        const proposer = agents.find((a) => this.pirateMap.get(a.account.addr.toString()) === proposerIndex)!

        const commitMbr = (await this.appClient!.send.getRequiredMbr({ args: { command: 'commitVote' } })).return!

        for (const agent of agents) {
          // Check if pirate is alive - FIX: use correct address encoding
          const pirateKey = this.getPlayerKey(sessionId, agent.account.addr.toString())
          const pirateData = await this.appClient!.state.box.pirates.value(pirateKey)

          if (!pirateData || !pirateData.alive) continue

          const votePrompt = this.buildVotePrompt(agent, proposer, distribution, agents, gameRound)
          const voteDecision = await agent.playRound(this.name, votePrompt)

          const vote = voteDecision.choice === 1 ? 1 : 0
          const salt = crypto.randomBytes(16).toString('hex')
          
          this.roundSecrets.set(agent.account.addr.toString(), { vote, salt })

          const hash = this.getHash(vote, salt)

          await this.appClient!.send.commitVote({
            args: {
              sessionId,
              voteHash: new Uint8Array(hash),
              mbrPayment: await this.algorand.createTransaction.payment({
                sender: agent.account.addr,
                receiver: this.appClient!.appAddress,
                amount: AlgoAmount.MicroAlgos(Number(commitMbr)),
              }),
            },
            sender: agent.account.addr,
            signer: agent.signer,
          })

          console.log(`[${agent.name}] Voted: ${vote === 1 ? 'YES ✅' : 'NO ❌'}`)
        }

        continue
      }

      if (gamePhase === 2 || gamePhase === 3) {
        const stateCheck = await this.appClient!.state.box.gameState.value(sessionId)
        if (Number(stateCheck!.phase) !== 2 && Number(stateCheck!.phase) !== 3) continue

        console.log(`\n--- ROUND ${gameRound}: REVEAL ---`)
        
        await this.waitUntilRound(stateCheck!.voteDeadline + 1n)

        for (const agent of agents) {
          const pirateKey = this.getPlayerKey(sessionId, agent.account.addr.toString())
          const pirateData = await this.appClient!.state.box.pirates.value(pirateKey)
          
          if (!pirateData || !pirateData.alive) continue

          const secret = this.roundSecrets.get(agent.account.addr.toString())
          if (!secret) continue

          try {
            await this.appClient!.send.revealVote({
              args: {
                sessionId,
                vote: BigInt(secret.vote),
                salt: Buffer.from(secret.salt),
              },
              sender: agent.account.addr,
              signer: agent.signer,
            })
            console.log(`[${agent.name}] Revealed`)
          } catch (e) {
            console.error(`[${agent.name}] Reveal failed:`, e)
          }
        }

        const stateBeforeExec = await this.appClient!.state.box.gameState.value(sessionId)
        await this.waitUntilRound(stateBeforeExec!.revealDeadline + 1n)

        console.log(`\n--- ROUND ${gameRound}: EXECUTION ---`)

        await this.appClient!.send.executeRound({
          args: { sessionId },
          sender: agents[0].account.addr,
          signer: agents[0].signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgo(3000),
        })

        const newState = await this.appClient!.state.box.gameState.value(sessionId)
        
        const passed = Number(newState!.phase) === 4
        
        console.log(passed ? '✅ PROPOSAL PASSED - GAME OVER' : '❌ PROPOSAL REJECTED - PROPOSER ELIMINATED')

        if (!passed) {
          console.log(`⚰️  Alive pirates: ${newState!.alivePirates}`)
        }

        this.roundSecrets.clear()
      }
    }
  }

  async resolve(dealer: Agent, sessionId: bigint, roundNumber: number): Promise<void> {
    // All resolution happens in play_Reveal
  }

  async play_Claim(agents: Agent[], sessionId: bigint, roundNumber: number): Promise<void> {
    console.log('\n--- PHASE: CLAIM ---')

    for (const agent of agents) {
      let outcome = 'LOSS'
      let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000

      try {
        const result = await this.appClient!.send.claimWinnings({
          args: { sessionId },
          sender: agent.account.addr,
          signer: agent.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgos(3_000),
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        console.log(`${agent.name}: \x1b[32m${outcome} (${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`)
      } catch (e: any) {
        if (e.message && e.message.includes('No winnings')) {
          console.log(`${agent.name}: \x1b[31mLOSS (No winnings)\x1b[0m`)
        } else if (e.message && e.message.includes('Not a pirate')) {
          console.log(`${agent.name}: \x1b[31mERROR (Not registered)\x1b[0m`)
        } else {
          console.log(`${agent.name}: \x1b[31mLOSS\x1b[0m`)
        }
      }

      agent.finalizeRound(this.name, outcome, netProfitAlgo, roundNumber)
    }
  }

  private async askForProposal(
    proposer: Agent,
    allAgents: Agent[],
    sessionId: bigint,
    gameRound: number
  ): Promise<number[]> {
    const state = await this.appClient!.state.box.gameState.value(sessionId)
    const totalPot = Number(state!.pot)
    const alivePirates = Number(state!.alivePirates)

    const prompt = this.buildProposalPrompt(proposer, allAgents, totalPot, alivePirates, gameRound)

    const response = await askLLM(prompt, proposer.model, {
      temperature: proposer.dynamicTemperature,
    })

    try {
      const match = response.reasoning.match(/\[[\d,\s]+\]/)
      if (match) {
        const distribution = JSON.parse(match[0]) as number[]
        
        if (distribution.length !== allAgents.length) {
          console.warn(`[${proposer.name}] ⚠️ Wrong array length (${distribution.length} vs ${allAgents.length}), using fallback`)
          return this.generateFallbackDistribution(proposer, allAgents, totalPot)
        }

        const sum = distribution.reduce((a, b) => a + b, 0)
        if (Math.abs(sum - totalPot) > 1000) {
          console.warn(`[${proposer.name}] ⚠️ Sum mismatch (${sum} vs ${totalPot}), using fallback`)
          return this.generateFallbackDistribution(proposer, allAgents, totalPot)
        }

        return distribution
      }
    } catch (e) {
      console.warn(`[${proposer.name}] ⚠️ Parse error, using fallback`)
    }

    return this.generateFallbackDistribution(proposer, allAgents, totalPot)
  }

  private generateFallbackDistribution(proposer: Agent, allAgents: Agent[], totalPot: number): number[] {
    const distribution = new Array(allAgents.length).fill(0)
    const proposerIndex = this.pirateMap.get(proposer.account.addr.toString())!

    if (proposer.profile.wealthFocus > 0.7) {
      distribution[proposerIndex] = Math.floor(totalPot * 0.7)
      const remaining = totalPot - distribution[proposerIndex]
      const share = Math.floor(remaining / (allAgents.length - 1))
      for (let i = 0; i < allAgents.length; i++) {
        if (i !== proposerIndex) distribution[i] = share
      }
    } else if (proposer.profile.fairnessFocus > 0.7) {
      const share = Math.floor(totalPot / allAgents.length)
      distribution.fill(share)
    } else {
      distribution[proposerIndex] = Math.floor(totalPot * 0.5)
      const remaining = totalPot - distribution[proposerIndex]
      const share = Math.floor(remaining / (allAgents.length - 1))
      for (let i = 0; i < allAgents.length; i++) {
        if (i !== proposerIndex) distribution[i] = share
      }
    }

    const sum = distribution.reduce((a, b) => a + b, 0)
    if (sum !== totalPot) {
      distribution[proposerIndex] += totalPot - sum
    }

    return distribution
  }

  private buildProposalPrompt(
    proposer: Agent,
    allAgents: Agent[],
    totalPot: number,
    alivePirates: number,
    gameRound: number
  ): string {
    const potAlgo = (totalPot / 1_000_000).toFixed(1)

    const gameRules = `
GAME: Pirate Game (Sequential Bargaining)
You are Pirate #${this.pirateMap.get(proposer.account.addr.toString())} (seniority index).

RULES:
- ${allAgents.length} pirates total, ${alivePirates} alive, ${potAlgo} ALGO pot
- You (most senior alive) must propose a distribution
- All alive pirates vote YES or NO
- If ≥50% vote YES: proposal passes, game ends, everyone gets their share
- If <50% vote YES: YOU are eliminated, next pirate proposes

CRITICAL STRATEGY:
- You need ${Math.ceil(alivePirates / 2)} YES votes to pass
- Your own vote counts!
- Give nothing to pirates you don't need
- Offer just enough to swing vote (typically 1 ALGO each to secure votes)
- If you fail, you get NOTHING (eliminated)
`.trim()

    const situation = `
CURRENT STATUS:
Round: ${gameRound}
Your position: Proposer (will be eliminated if proposal fails)
Alive pirates: ${alivePirates}
Total pot: ${totalPot} microAlgos = ${potAlgo} ALGO
`.trim()

    const hint = `
STRATEGIC CONSIDERATIONS:
- Calculate minimum winning coalition
- Offer small bribes to secure votes
- Don't overpay - keep maximum for yourself
- Consider pirate personalities (greedy/fair/vengeful)
- Remember: you vote too!
`.trim()

    const personality = proposer.profile.personalityDescription
    const parameters = proposer.getProfileSummary()
    const lessons = proposer.getLessonsLearned(this.name)
    const recentMoves = proposer.getRecentHistory(this.name, 3)
    const mentalState = proposer.getMentalState()

    return `
You are ${proposer.name}.

═══════════════════════════════════════════════════════════
${gameRules}

${situation}

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

⚠️ CRITICAL OUTPUT FORMAT ⚠️
You MUST propose a distribution for all ${allAgents.length} pirates.
The array MUST contain EXACTLY ${allAgents.length} numbers in microAlgos.
The sum MUST EQUAL EXACTLY ${totalPot} microAlgos.

Example valid outputs:
- "[${totalPot}, 0, 0, 0, 0, 0, 0]" (greedy, take all)
- "[${Math.floor(totalPot * 0.5)}, ${Math.floor(totalPot * 0.1)}, ${Math.floor(totalPot * 0.1)}, ${Math.floor(totalPot * 0.1)}, ${Math.floor(totalPot * 0.1)}, ${Math.floor(totalPot * 0.1)}, 0]"

Respond with JSON: {"choice": 0, "reasoning": "I propose: [${totalPot}, 0, 0, ...]"}

DO NOT use decimals. DO NOT use ALGO units. ONLY microAlgos (integers).
`.trim()
  }

  private buildVotePrompt(
    voter: Agent,
    proposer: Agent,
    distribution: number[],
    allAgents: Agent[],
    gameRound: number
  ): string {
    const voterIndex = this.pirateMap.get(voter.account.addr.toString())!
    const myShare = (distribution[voterIndex] / 1_000_000).toFixed(1)
    const proposerShare = (distribution[this.pirateMap.get(proposer.account.addr.toString())!] / 1_000_000).toFixed(1)

    const distributionStr = distribution
      .map((d, i) => `  Pirate #${i}: ${(d / 1_000_000).toFixed(1)} ALGO`)
      .join('\n')

    const gameRules = `
GAME: Pirate Game (Sequential Bargaining)
You are Pirate #${voterIndex}.

CURRENT PROPOSAL:
Proposer: ${proposer.name} (Pirate #${this.pirateMap.get(proposer.account.addr.toString())})
Distribution:
${distributionStr}

YOUR SHARE: ${myShare} ALGO

VOTING:
- Vote YES (1) or NO (0)
- If ≥50% vote YES: proposal passes, you get ${myShare} ALGO
- If <50% vote YES: proposer eliminated, next pirate proposes
`.trim()

    const hint = `
STRATEGIC CONSIDERATIONS:
- If you vote NO, proposer is eliminated
- Next proposer might offer you less (or nothing!)
- Consider: is ${myShare} ALGO better than waiting?
- Think about your position in seniority order
`.trim()

    const personality = voter.profile.personalityDescription
    const parameters = voter.getProfileSummary()
    const lessons = voter.getLessonsLearned(this.name)
    const recentMoves = voter.getRecentHistory(this.name, 3)
    const mentalState = voter.getMentalState()

    return `
You are ${voter.name}.

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

Respond ONLY with JSON: {"choice": <0 or 1>, "reasoning": "<your explanation>"}
`.trim()
  }

  // ✅ FIX: Correct address encoding to match smart contract
  private getPlayerKey(sessionId: bigint, playerAddr: string): Buffer {
    // CRITICAL: Must match contract's getRoundCommitKey implementation
    // Contract: sha256(itob(sessionID).concat(itob(round)).concat(player.bytes))
    
    const sessionIdBuffer = Buffer.alloc(8)
    sessionIdBuffer.writeBigUInt64BE(sessionId)
    
    // Decode Base32 Algorand address to raw 32 bytes
    const addressBytes = decodeAddress(playerAddr).publicKey
    
    return Buffer.from(
      crypto
        .createHash('sha256')
        .update(Buffer.concat([sessionIdBuffer, Buffer.from(addressBytes)]))
        .digest()
    )
  }

  private getHash(choice: number, salt: string): Uint8Array {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(choice))
    return new Uint8Array(
      crypto
        .createHash('sha256')
        .update(Buffer.concat([b, Buffer.from(salt)]))
        .digest(),
    )
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
