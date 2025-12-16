/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { Agent } from '../agent'; 
import { WeeklyGameFactory, WeeklyGameClient } from '../../smart_contracts/artifacts/weeklyGame/WeeklyGameClient';
import { IGameAdapter } from './IGameAdapter';

interface RoundSecret {
  choice: number;
  salt: string;
}

export class WeeklyGame implements IGameAdapter {
  // 1. STATO PER ANALISI (Aggiunta)
  private lastRoundVotes: Record<string, number> | null = null;

  private algorand = AlgorandClient.defaultLocalNet();
  private factory: WeeklyGameFactory | null = null;
  private appClient: WeeklyGameClient | null = null;
  
  private participationAmount = AlgoAmount.Algos(10);
  private roundSecrets: Map<string, RoundSecret> = new Map();
  private sessionConfig: { startAt: bigint; endCommitAt: bigint; endRevealAt: bigint } | null = null;

  private durationParams = {
    warmUp: 3n,     
    commitPhase: 15n, 
    revealPhase: 10n  
  };

  private dayMap = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

  // --- 1. DEPLOY ---
  async deploy(admin: Agent): Promise<bigint> {
    this.factory = this.algorand.client.getTypedAppFactory(WeeklyGameFactory, {
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
    console.log(`Contratto WeeklyGame deployato. AppID: ${appClient.appId}`);
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

    console.log(`Sessione WeeklyGame creata! ID: ${result.return}. Start: ${startAt}`);
    await this.waitUntilRound(startAt);
    return result.return!;
  }

  // --- 3. FASE COMMIT (MODIFICATA) ---
  async play_Commit(agents: Agent[], sessionId: bigint): Promise<void> {
    console.log(`\n--- FASE 1: COMMIT (Scelta del Giorno) ---`);

    const potEst = agents.length * 10; 

    // 1. REGOLE
    const rules = `
      GIOCO: Weekly Game (Il Dilemma dei Giorni).
      SITUAZIONE: Ci sono 7 giorni (0=Lun, ..., 6=Dom). Piatto stimato: ${potEst} ALGO. Costo: ${this.participationAmount} ALGO.
      
      MECCANICA DI VINCITA:
      1. Il piatto totale viene diviso equamente tra i giorni "Attivi" (scelti da almeno una persona).
      2. La quota di quel giorno viene poi divisa tra i giocatori che hanno scelto quel giorno.
      
      STRATEGIA OTTIMALE:
      Devi scegliere un giorno che verrà scelto da POCHE persone.
      - Se sei l'unico su un giorno: VINCI MOLTO (Prendi l'intera quota del giorno).
      - Se tutti scelgono il tuo giorno: VINCI POCO (Devi dividere con tutti).
      
      LE TUE OPZIONI:
      0=Lunedì, 1=Martedì, 2=Mercoledì, 3=Giovedì, 4=Venerdì, 5=Sabato, 6=Domenica.
    `;

    // 2. ANALISI MERCATO
    let marketAnalysis = "Primo Round: Nessun dato storico. I giorni sono tutti uguali al momento. Cerca di essere imprevedibile.";
    
    if (this.lastRoundVotes) {
        const sortedDays = Object.entries(this.lastRoundVotes)
            .sort(([, countA], [, countB]) => countA - countB); // Crescente: meno voti -> più voti
        
        const bestDay = sortedDays[0]; // Meno voti
        const worstDay = sortedDays[sortedDays.length - 1]; // Più voti

        marketAnalysis = `
        📊 REPORT AFFOLLAMENTO (Round Precedente):
        - GIORNO MIGLIORE (Deserto): ${bestDay[0]} (solo ${bestDay[1]} voti).
        - GIORNO PEGGIORE (Affollato): ${worstDay[0]} (${worstDay[1]} voti).
        
        ANALISI STRATEGICA:
        Molti agenti "semplici" si butteranno sul Giorno Migliore del turno scorso. Questo lo renderà affollato (Oscillazione).
        Gli agenti "statici" rimarranno sul Giorno Peggiore per inerzia.
        Cerca un giorno intermedio o anticipa l'oscillazione.
        `;
    }

    const objectiveHint = "Questo è un GIOCO DI MINORANZA. Vinci solo se scegli un giorno scelto da POCHE persone. Se segui la massa, perdi.";

    for (const agent of agents) {
        // CHIAMATA CON CONTEXT
        const decision = await agent.playRound("WeeklyGame", {
            rules: rules,
            marketAnalysis: marketAnalysis,
            objectiveHint: objectiveHint
        });
        
        let safeChoice = decision.choice;
        if (safeChoice < 0 || safeChoice > 6) {
            console.warn(`[${agent.name}] Scelta invalida (${safeChoice}), fallback a 0.`);
            safeChoice = 0;
        }

        const salt = crypto.randomBytes(16).toString('hex');
        this.roundSecrets.set(agent.account.addr.toString(), { choice: safeChoice, salt });

        const hash = this.getHash(safeChoice, salt);
        console.log(`[${agent.name}] Sceglie un giorno (Hash inviato).`);

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
            console.log(`[${agent.name}] Rivela: ${this.dayMap[secret.choice]} (${secret.choice})`);
        } catch (e) {
            console.error(`Errore Reveal per ${agent.name}:`, e);
        }
    }));
  }

  // --- 5. FASE INCASSO & DATA COLLECTION ---
  // Aggiunto parametro currentRound
  async play_Claim(agents: Agent[], sessionId: bigint): Promise<void> {
    if (!this.sessionConfig) throw new Error("Config mancante");

    console.log(`\n--- FASE 3: CALCOLO E INCASSO ---`);
    await this.waitUntilRound(this.sessionConfig.endRevealAt + 1n);
    
    // 1. RACCOLTA VOTI PER ANALISI PROSSIMO ROUND
    const votes: Record<string, number> = {};
    const daysMap = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

    // Inizializza a 0 per evitare undefined
    daysMap.forEach(d => votes[d] = 0);

    agents.forEach(agent => {
        // Recupera l'ultima scelta valida (dai secrets locali se la history non è ancora aggiornata, o viceversa)
        // Qui usiamo i secrets perché sono sicuri e disponibili subito
        const secret = this.roundSecrets.get(agent.account.addr.toString());
        if (secret) {
            const dayName = daysMap[secret.choice];
            votes[dayName] = (votes[dayName] || 0) + 1;
        }
    });
    this.lastRoundVotes = votes;
    console.log("📊 [STATS GIOCO] Voti rilevati:", votes);

    // 2. INCASSO
    for (const agent of agents) {
        let outcome = "LOSS";
        let netProfitAlgo = -Number(this.participationAmount.microAlgos) / 1_000_000; 

        try {
            const result = await this.appClient!.send.claimWinnings({
                args: { sessionId: sessionId },
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
            if (e.message && e.message.includes("assert failed")) {
                console.log(`${agent.name}: \x1b[31mLOSS (Nessuna vincita)\x1b[0m`);
            } else {
                console.error(`❌ Errore inatteso per ${agent.name}:`, e.message);
            }
        }
        
        // Passiamo dati e currentRound
        const groupContext = outcome === "WIN" ? "WIN" : "LOSS"; // In minority game, se vinci tu, hai vinto contro il gruppo "massa"
        agent.finalizeRound("WeeklyGame", outcome, netProfitAlgo, groupContext, 1);
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
