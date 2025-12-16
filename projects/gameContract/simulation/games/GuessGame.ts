/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { Agent } from '../agent'; 
import { GuessGameFactory, GuessGameClient } from '../../smart_contracts/artifacts/guessGame/GuessGameClient';
import { IGameAdapter } from './IGameAdapter';

interface RoundSecret {
  choice: number;
  salt: string;
}

export class GuessGame implements IGameAdapter {
  // 1. STORIA DEL GIOCO (Aggiunta chiave)
  private roundHistory: { avg: number, target: number }[] = [];
  
  private algorand = AlgorandClient.defaultLocalNet();
  private factory: GuessGameFactory | null = null;
  private appClient: GuessGameClient | null = null;
  
  private participationAmount = AlgoAmount.Algos(10);
  private roundSecrets: Map<string, RoundSecret> = new Map();
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null;

  private durationParams = {
    warmUp: 3n,     
    commitPhase: 15n, 
    revealPhase: 10n  
  };

  // --- 1. DEPLOY ---
  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(GuessGameFactory, {
        defaultSender: admin.account.addr,
        defaultSigner: admin.signer
    });

    const { appClient } = await this.factory.deploy({
        onUpdate: 'append',
        onSchemaBreak: 'append'
    });
    
    await this.algorand.account.ensureFundedFromEnvironment(
        appClient.appAddress, 
        AlgoAmount.Algos(5) 
    );

    this.appClient = appClient;
    console.log(`📜 Contratto GuessGame deployato. AppID: ${appClient.appId}`);
    return BigInt(appClient.appId);
  }

  // --- 2. START SESSION ---
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error("Fai prima il deploy!");
    
    const status = await this.algorand.client.algod.status().do() as any;
    const currentRound = BigInt(status['lastRound']);
    
    const startAt = currentRound + this.durationParams.warmUp;
    const endCommitAt = startAt + this.durationParams.commitPhase;
    const endRevealAt = endCommitAt + this.durationParams.revealPhase;

    this.sessionConfig = { startAt, endCommitAt, endRevealAt };

    const mbr = (await this.appClient.send.getRequiredMbr({ args: { command: 'newGame' } })).return!;
    
    const mbrPayment = await this.algorand.createTransaction.payment({
        sender: dealer.account.addr,
        receiver: this.appClient.appAddress,
        amount: AlgoAmount.MicroAlgos(mbr)
    });

    const result = await this.appClient.send.createSession({
        args: { 
            config: {
                startAt,
                endCommitAt,
                endRevealAt,
                participation: this.participationAmount.microAlgos
            }, 
            mbrPayment 
        },
        sender: dealer.account.addr,
        signer: dealer.signer
    });

    console.log(`🎲 Sessione GuessGame creata! ID: ${result.return}. Start: ${startAt}`);
    await this.waitUntilRound(startAt);
    return result.return!;
  }

  // --- 3. FASE COMMIT (MODIFICATA PER CONTEXT) ---
  async play_Commit(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log(`\n--- FASE 1: COMMIT (Indovina 2/3 della Media) ---`);

    const potEst = agents.length * 10; 

    const rules = `
      GIOCO: Guess 2/3 of the Average.
      SITUAZIONE: Piatto stimato: ${potEst} ALGO. Costo: ${this.participationAmount} ALGO.
      
      REGOLE:
      1. Tutti scelgono un numero intero tra 0 e 100.
      2. Si calcola la media di tutti i numeri scelti.
      3. Il Target vincente è i 2/3 di quella media.
      4. Vince chi si avvicina di più al Target.
      
      ANALISI STRATEGICA (Level-k Thinking):
      - Livello 0: Se tutti scelgono a caso, la media è 50. Target = 33.
      - Livello 1: Se tutti pensano al Livello 0, sceglieranno 33. La media sarà 33. Target = 22.
      - Nash Equilibrium: Tutti scelgono 0.
    `;

    // 2. CREAZIONE DEL CONTESTO ANALITICO
    let marketAnalysis = "Primo Round: Non ci sono dati storici. La media teorica di numeri casuali (0-100) è 50, quindi il target iniziale è spesso attorno a 33.";
    
    if (this.roundHistory.length > 0) {
        const lastData = this.roundHistory[this.roundHistory.length - 1];
        marketAnalysis = `
        ⚠️ TREND REPORT (Round Precedente):
        - Media Giocata: ${lastData.avg.toFixed(2)}
        - TARGET VINCENTE (2/3): ${lastData.target.toFixed(2)}
        
        ANALISI TENDENZA:
        In questo gioco, gli agenti intelligenti tendono ad abbassare le loro stime round dopo round.
        Se nel round scorso il target era ${lastData.target.toFixed(2)}, in questo round sarà quasi sicuramente PIÙ BASSO.
        Giocare un numero superiore a ${lastData.target.toFixed(2)} è statisticamente una mossa perdente.
        `;
    }

    const objectiveHint = "Il tuo obiettivo è indovinare un numero che sia pari ai 2/3 della media di TUTTI i numeri scelti. Devi anticipare la massa e stare SOTTO la media.";

    for (const agent of agents) {
        // CHIAMATA CON CONTEXT STRUTTURATO
        const decision = await agent.playRound("GuessGame", {
            rules: rules,
            marketAnalysis: marketAnalysis,
            objectiveHint: objectiveHint
        });
        
        let safeChoice = Math.round(decision.choice);
        if (safeChoice < 0) safeChoice = 0;
        if (safeChoice > 100) safeChoice = 100;

        const salt = crypto.randomBytes(16).toString('hex');
        this.roundSecrets.set(agent.account.addr.toString(), { choice: safeChoice, salt });

        const hash = this.getHash(safeChoice, salt);
        console.log(`[${agent.name}] Ha scelto un numero (Hash inviato).`);

        const payment = await this.algorand.createTransaction.payment({
            sender: agent.account.addr,
            receiver: this.appClient!.appAddress,
            amount: this.participationAmount
        });

        await this.appClient!.send.joinSession({
            args: { sessionId, commit: hash, payment },
            sender: agent.account.addr,
            signer: agent.signer
        });
    }
  }

  // --- 4. FASE REVEAL ---
  async play_Reveal(agents: Agent[], sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error("Config mancante");

    console.log(`\n--- FASE 2: REVEAL ---`);
    await this.waitUntilRound(this.sessionConfig.endCommitAt + 1n);

    await Promise.all(agents.map(async (agent) => {
        const secret = this.roundSecrets.get(agent.account.addr.toString());
        if (!secret) return; 

        try {
            await this.appClient!.send.revealMove({
                args: { 
                    sessionId, 
                    choice: BigInt(secret.choice), 
                    salt: Buffer.from(secret.salt) 
                },
                sender: agent.account.addr,
                signer: agent.signer
            });
            console.log(`[${agent.name}] Rivela: ${secret.choice}`);
        } catch (e) {
            console.error(`Errore Reveal per ${agent.name}:`, e);
        }
    }));
  }

  // --- 5. FASE INCASSO (MODIFICATA PER STATISTICHE) ---
  // Aggiunto parametro currentRound
  async play_Claim(agents: Agent[], sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error("Config mancante");

    console.log(`\n--- FASE 3: CALCOLO E INCASSO ---`);
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n);
    
    // --- RACCOLTA DATI PER IL PROSSIMO ROUND ---
    const currentRoundChoices: number[] = [];
    agents.forEach(agent => {
        // Usiamo il getter pubblico che abbiamo aggiunto ad Agent.ts
        const lastMove = agent.getLastMove("GuessGame"); 
        if (lastMove) {
             currentRoundChoices.push(lastMove.choice);
        } else {
             const secret = this.roundSecrets.get(agent.account.addr.toString());
             if (secret) currentRoundChoices.push(secret.choice);
        }
    });

    if (currentRoundChoices.length > 0) {
        const sum = currentRoundChoices.reduce((a, b) => a + b, 0);
        const avg = sum / currentRoundChoices.length;
        const target = avg * (2/3);
        
        this.roundHistory.push({ avg, target });
    }

    // --- LOGICA INCASSO ---
    for (const agent of agents) {
        let outcome = "LOSS";
        let netProfitAlgo = -Number(this.participationAmount.microAlgos)/1_000_000; 

        try {
            const result = await this.appClient!.send.claimWinnings({
                args: { sessionId: sessionId },
                sender: agent.account.addr,
                signer: agent.signer,
                coverAppCallInnerTransactionFees: true,
                maxFee: AlgoAmount.MicroAlgos(5_000)
            });
            
            const payoutMicro = Number(result.return!);
            const entryMicro = Number(this.participationAmount.microAlgos);
            netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000;
            
            outcome = netProfitAlgo > 0 ? "WIN" : (netProfitAlgo === 0 ? "DRAW" : "LOSS");
            console.log(`${agent.name}: \x1b[32m${outcome} (${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`);

        } catch (e: any) {
            if (e.message && e.message.includes("assert failed")) {
                console.log(`${agent.name}: \x1b[31mLOSS (Nessuna vincita)\x1b[0m`);
            } else {
                console.error(`❌ Errore inatteso per ${agent.name}:`, e.message);
            }        
        }
        
        // Passiamo i dati all'agente con il round corretto
        const groupContext = outcome === "WIN" ? "WIN" : "LOSS";
        agent.finalizeRound("GuessGame", outcome, netProfitAlgo, groupContext, 1);
    }
  }

  // --- UTILS ---

  private getHash(choice: number, salt: string): Uint8Array {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(choice)); 
    return new Uint8Array(crypto.createHash('sha256').update(Buffer.concat([b, Buffer.from(salt)])).digest());
  }

  private async waitUntilRound(targetRound: bigint) {
    const status = await this.algorand.client.algod.status().do() as any;
    const currentRound = BigInt(status['lastRound']);

    if (currentRound >= targetRound) return;

    const blocksToSpam = Number(targetRound - currentRound);
    const spammer = await this.algorand.account.random();
    await this.algorand.account.ensureFundedFromEnvironment(spammer.addr, AlgoAmount.Algos(1));

    for(let i = 0; i < blocksToSpam; i++) {
        await this.algorand.send.payment({
            sender: spammer.addr,
            receiver: spammer.addr,
            amount: AlgoAmount.MicroAlgos(0), 
            signer: spammer.signer,
            note: `spam-${i}-${Date.now()}` 
        });
    }
  }

  async resolve(dealer: Agent, sessionId: bigint): Promise<void> {
      return;
  }
}
