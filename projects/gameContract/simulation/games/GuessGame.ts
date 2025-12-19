/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { GuessGameClient, GuessGameFactory } from '../../smart_contracts/artifacts/guessGame/GuessGameClient'
import { Agent, RoundContext } from '../Agent'
import { IGameAdapter } from './IGameAdapter'

interface RoundSecret {
  choice: number
  salt: string
}

export class GuessGame implements IGameAdapter {
  // Game history tracking
  private roundHistory: { avg: number; target: number }[] = []

  private algorand = AlgorandClient.defaultLocalNet()
  private factory: GuessGameFactory | null = null
  private appClient: GuessGameClient | null = null

  private participationAmount = AlgoAmount.Algos(10)
  private roundSecrets: Map<string, RoundSecret> = new Map()
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null

  private durationParams = {
    warmUp: 3n,
    commitPhase: 15n,
    revealPhase: 10n,
  }

  // --- 1. DEPLOY ---
  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(GuessGameFactory, {
      defaultSender: admin.account.addr,
      defaultSigner: admin.signer,
    })

    const { appClient } = await this.factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
    })

    await this.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, AlgoAmount.Algos(5))

    this.appClient = appClient
    console.log(`📜 GuessGame contract deployed. AppID: ${appClient.appId}`)
    return BigInt(appClient.appId)
  }

  // --- 2. START SESSION ---
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
      },
      sender: dealer.account.addr,
      signer: dealer.signer,
    })

    console.log(`🎲 GuessGame session created! ID: ${result.return}. Start: ${startAt}`)
    await this.waitUntilRound(startAt)
    return result.return!
  }

  // --- 3. COMMIT PHASE ---
  async play_Commit(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log(`\n--- PHASE 1: COMMIT (Guess 2/3 of Average) ---`)

    // Prepare context with data-only approach (no prescriptive hints)
    const marketSituation = this.prepareMarketSituation()

    const context: RoundContext = {
      gameRules: 'Choose integer 0-100. Target = 2/3 of average of all choices. Closest to target wins pot.',
      marketSituation: marketSituation,
    }

    for (const agent of agents) {
      const decision = await agent.playRound('GuessGame', context)

      let safeChoice = Math.round(decision.choice)
      if (safeChoice < 0) safeChoice = 0
      if (safeChoice > 100) safeChoice = 100

      const salt = crypto.randomBytes(16).toString('hex')
      this.roundSecrets.set(agent.account.addr.toString(), { choice: safeChoice, salt })

      const hash = this.getHash(safeChoice, salt)
      console.log(`[${agent.name}] Committed choice (hash sent).`)

      const payment = await this.algorand.createTransaction.payment({
        sender: agent.account.addr,
        receiver: this.appClient!.appAddress,
        amount: this.participationAmount,
      })

      await this.appClient!.send.joinSession({
        args: { sessionId, commit: hash, payment },
        sender: agent.account.addr,
        signer: agent.signer,
      })
    }
  }

  // --- PREPARE MARKET SITUATION (DATA-ONLY) ---
  private prepareMarketSituation(): string {
    if (this.roundHistory.length === 0) {
      return 'First round. No historical data available.'
    }

    // Show raw data - AI must infer patterns
    const last = this.roundHistory[this.roundHistory.length - 1]
    let text = `Last round: Average was ${last.avg.toFixed(1)}, Target was ${last.target.toFixed(1)}.`

    // Show historical sequence (last 3-5 rounds)
    if (this.roundHistory.length >= 3) {
      const lastTargets = this.roundHistory.slice(-5).map((h) => h.target.toFixed(1))
      text += `\nTarget history (last ${lastTargets.length} rounds): ${lastTargets.join(' → ')}.`
    }

    return text
  }

  // --- 4. REVEAL PHASE ---
  async play_Reveal(agents: Agent[], sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 2: REVEAL ---`)
    await this.waitUntilRound(this.sessionConfig.endCommitAt + 1n)

    await Promise.all(
      agents.map(async (agent) => {
        const secret = this.roundSecrets.get(agent.account.addr.toString())
        if (!secret) return

        try {
          await this.appClient!.send.revealMove({
            args: {
              sessionId,
              choice: BigInt(secret.choice),
              salt: Buffer.from(secret.salt),
            },
            sender: agent.account.addr,
            signer: agent.signer,
          })
          console.log(`[${agent.name}] Revealed: ${secret.choice}`)
        } catch (e) {
          console.error(`Error revealing for ${agent.name}:`, e)
        }
      }),
    )
  }

  // --- 5. CLAIM PHASE (+ DATA COLLECTION) ---
  async play_Claim(agents: Agent[], sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error('Config missing')

    console.log(`\n--- PHASE 3: CLAIM & DATA COLLECTION ---`)
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n)

    // Collect data for next round analysis
    const currentRoundChoices: number[] = []
    agents.forEach((agent) => {
      const secret = this.roundSecrets.get(agent.account.addr.toString())
      if (secret) currentRoundChoices.push(secret.choice)
    })

    if (currentRoundChoices.length > 0) {
      const sum = currentRoundChoices.reduce((a, b) => a + b, 0)
      const avg = sum / currentRoundChoices.length
      const target = avg * (2 / 3)

      this.roundHistory.push({ avg, target })
      console.log(`📊 Round Stats: Avg=${avg.toFixed(1)}, Target=${target.toFixed(1)}`)
    }

    // Process claims
    for (const agent of agents) {
      let outcome = 'LOSS'
      let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000

      try {
        const result = await this.appClient!.send.claimWinnings({
          args: { sessionId: sessionId },
          sender: agent.account.addr,
          signer: agent.signer,
          coverAppCallInnerTransactionFees: true,
          maxFee: AlgoAmount.MicroAlgos(5_000),
        })

        const payoutMicro = Number(result.return!)
        const entryMicro = Number(this.participationAmount.microAlgos)
        netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000

        outcome = netProfitAlgo > 0 ? 'WIN' : netProfitAlgo === 0 ? 'DRAW' : 'LOSS'
        console.log(`${agent.name}: \x1b[32m${outcome} (${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`)
      } catch (e: any) {
        if (e.message && e.message.includes('assert failed')) {
          console.log(`${agent.name}: \x1b[31mLOSS (No winnings)\x1b[0m`)
        } else {
          console.error(`❌ Unexpected error for ${agent.name}:`, e.message)
        }
      }

      const groupContext = outcome === 'WIN' ? 'WIN' : 'LOSS'
      agent.finalizeRound('GuessGame', outcome, netProfitAlgo, groupContext, this.roundHistory.length)
    }
  }

  // --- UTILS ---
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

  async resolve(dealer: Agent, sessionId: bigint): Promise<void> {
    return
  }
}
