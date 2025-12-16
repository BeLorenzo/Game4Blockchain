/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { Agent } from '../agent'; 
import { StagHuntFactory, StagHuntClient } from '../../smart_contracts/artifacts/stagHunt/StagHuntClient';

interface RoundSecret {
  choice: number;
  salt: string;
}

export class StagHuntGame {
  // 1. STATO PER ANALISI (Nuovo)
  private lastCooperationRate: number | null = null; // Da 0.0 a 1.0

  private algorand = AlgorandClient.defaultLocalNet();
  private factory: StagHuntFactory | null = null;
  private appClient: StagHuntClient | null = null;
  
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
    this.factory = this.algorand.client.getTypedAppFactory(StagHuntFactory, {
        defaultSender: admin.account.addr,
        defaultSigner: admin.signer
    });

    const { appClient } = await this.factory.deploy({
        onUpdate: 'append',
        onSchemaBreak: 'append'
    });
    
    await this.algorand.account.ensureFundedFromEnvironment(
        appClient.appAddress, 
        AlgoAmount.Algos(2) 
    );

    this.appClient = appClient;
    console.log(`Contratto StagHunt deployato. AppID: ${appClient.appId}`);
    return BigInt(appClient.appId);
  }

  // --- 2. START SESSION ---
  async startSession(dealer: Agent): Promise<bigint> {
    if (!this.appClient) throw new Error("Fai prima il deploy!");
    
    const status = await this.algorand.client.algod.status().do();
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

    console.log(`Sessione creata! ID: ${result.return}. Si inizia al round ${startAt}`);
    
    await this.waitUntilRound(startAt);
    return result.return!;
  }

  // --- 3. FASE COMMIT (MODIFICATA) ---
  async play_Commit(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log(`\n--- FASE 1: COMMIT ---`);

    const globalState = await this.appClient!.state.global.getAll();
    const jackpotVal = Number(globalState['globalJackpot']);
    const jackpotAlgo = jackpotVal / 1_000_000;

    // 1. REGOLE FISSE
    const rules = `
      GIOCO: Stag Hunt (Caccia al Cervo).
      POSTA: Jackpot attuale ${jackpotAlgo} ALGO. Costo ingresso: ${this.participationAmount} ALGO.
      
      OPZIONE 1: "CERVO" (Collaborazione)
      - Profilo Rischio: ALTO.
      - Richiede che la maggioranza collabori.
      - Vincita potenziale: Molto Alta (Jackpot).
      
      OPZIONE 0: "LEPRE" (Defezione)
      - Profilo Rischio: BASSO.
      - Scelta difensiva.
      - Perdita sicura ma limitata.
    `;

    // 2. ANALISI DI MERCATO (SENTIMENT)
    let marketAnalysis = "Primo Round: Nessun dato storico. Il clima è neutro. Cooperare è un atto di fede.";
    
    if (this.lastCooperationRate !== null) {
        const ratePercent = (this.lastCooperationRate * 100).toFixed(0);
        let sentiment = "";
        
        if (this.lastCooperationRate > 0.7) {
            sentiment = "MOLTO POSITIVO (High Trust). Il gruppo è solido, il Cervo è la scelta razionale.";
        } else if (this.lastCooperationRate < 0.4) {
            sentiment = "TOSSICO (Low Trust). Il tradimento è diffuso. Giocare Cervo ora è molto rischioso.";
        } else {
            sentiment = "INCERTO (Volatile). Il gruppo è diviso.";
        }

        marketAnalysis = `
        🌡️ CLIMA SOCIALE (Round Precedente):
        - Tasso di Cooperazione: ${ratePercent}% degli agenti ha scelto Cervo.
        - Sentiment di Mercato: ${sentiment}
        
        TENDENZA:
        Gli agenti tendono a reagire al turno precedente.
        - Se la fiducia era alta, probabilmente resterà alta.
        - Se la fiducia era bassa, aspettati ancora defezioni.
        `;
    } 

    const objectiveHint = "Stag Hunt è un gioco di coordinamento. Non guardare solo il tuo profitto immediato, guarda cosa fanno gli altri. Se il Clima è 'Tossico', difenditi (Lepre). Se è 'Positivo', collabora (Cervo).";

    for (const agent of agents) {
        // CHIAMATA CON CONTEXT
        const decision = await agent.playRound("StagHunt", {
            rules: rules,
            marketAnalysis: marketAnalysis,
            objectiveHint: objectiveHint
        });
        
        const salt = crypto.randomBytes(16).toString('hex');
        
        this.roundSecrets.set(agent.account.addr.toString(), { 
            choice: decision.choice, 
            salt: salt 
        });

        const hash = this.getHash(decision.choice, salt);
        
        console.log(`[${agent.name}] Decide: ${decision.choice} (Hash inviato)`);

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
            console.log(`[${agent.name}] Svela: ${secret.choice === 1 ? 'CERVO' : 'LEPRE'}`);
        } catch (e) {
            console.error(`Errore Reveal per ${agent.name}:`, e);
        }
    }));
  }

  // --- 5. FASE RESOLVE & DATA COLLECTION ---
  async resolve(dealer: Agent, sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error("Config mancante");

    console.log(`\n--- FASE 3: RISOLUZIONE ---`);
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n);

    // 1. RACCOLTA DATI PER IL PROSSIMO ROUND (Analisi Cooperazione)
    let stags = 0;
    let totalRevealed = 0;

    // Usiamo la mappa roundSecrets locale che è affidabile per la simulazione
    this.roundSecrets.forEach((secret) => {
        // Qui assumiamo che se hanno fatto reveal, la scelta è valida.
        // In una simulazione reale dovremmo controllare chi ha fatto reveal con successo,
        // ma per ora questo è una buona approssimazione del "sentiment".
        totalRevealed++;
        if (secret.choice === 1) stags++;
    });

    if (totalRevealed > 0) {
        this.lastCooperationRate = stags / totalRevealed;
        console.log(`📊 [STATS GIOCO] Cooperazione rilevata: ${(this.lastCooperationRate * 100).toFixed(1)}%`);
    } else {
        this.lastCooperationRate = 0;
    }

    // 2. RISOLUZIONE SU CHAIN
    try {
        await this.appClient!.send.resolveSession({
            args: { sessionId },
            sender: dealer.account.addr,
            signer: dealer.signer,
            coverAppCallInnerTransactionFees: true,
            maxFee: AlgoAmount.MicroAlgos(5_000)
        });
    } catch (e) {
        console.error("Errore Risoluzione:", e);
    }
  }

  // --- 6. FASE INCASSO & APPRENDIMENTO ---
  async play_Claim(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log("\n--- FASE 4: INCASSO & FEEDBACK ---");
    
    // Recuperiamo il risultato del gruppo (se hanno vinto o perso il jackpot)
    // Questo serve per il "GroupResult" dell'agente
    let groupResult = "LOSS";
    try {
        const stats = await this.appClient?.state.box.stats.value(sessionId);
        if (stats && stats.successful) groupResult = "WIN";
    } catch (e) {}

    for (const agent of agents) {
        let outcome = "LOSS";
        let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000; 

        try {
            const result = await this.appClient!.send.claimWinnings({
                args: { sessionId },
                sender: agent.account.addr,
                signer: agent.signer,
                coverAppCallInnerTransactionFees: true,
                maxFee: AlgoAmount.MicroAlgos(3_000)
            });
            
            const payoutMicro = Number(result.return!);
            const entryMicro = Number(this.participationAmount.microAlgos);
            netProfitAlgo = (payoutMicro - entryMicro) / 1_000_000;
            
            outcome = netProfitAlgo > 0 ? "WIN" : (netProfitAlgo === 0 ? "DRAW" : "LOSS");
            console.log(`${agent.name}: \x1b[32m${outcome} (${netProfitAlgo.toFixed(2)} ALGO)\x1b[0m`);
        } catch (e: any) {
            // Gestione errore assert pulita
             if (e.message && e.message.includes("assert failed")) {
                 console.log(`${agent.name}: \x1b[31mLOSS (Nessuna vincita)\x1b[0m`);
             } else {
                 console.log(`${agent.name}: ERROR (${e.message.substring(0, 50)}...)`);
             }
        }
        
        // Passiamo currentRound correttamente
        agent.finalizeRound("StagHunt", outcome, netProfitAlgo, groupResult, 1);
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
}
