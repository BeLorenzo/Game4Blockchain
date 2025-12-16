/* eslint-disable @typescript-eslint/no-explicit-any */
import { Account, TransactionSigner } from 'algosdk';
import * as fs from 'fs';
import * as path from 'path';
import { askLLM, LLMDecision } from './llm';
import { 
  Document, 
  VectorStoreIndex, 
  storageContextFromDefaults, 
  Settings,
  TextNode
} from "llamaindex";
import { OllamaEmbedding } from "@llamaindex/ollama";

// Configurazione Ollama per i vettori
Settings.embedModel = new OllamaEmbedding({ model: "nomic-embed-text" });

// --- INTERFACCE ESTERNE (CONTEXT) ---
// Questa è la chiave per rendere l'agente generico.
// Il gioco deve preparare questi dati prima di chiamare l'agente.
export interface RoundContext {
    rules: string;          // Regole fisse del gioco
    marketAnalysis: string; // Analisi dinamica (es. "La media sta scendendo")
    objectiveHint: string;  // Suggerimento strategico (es. "Gioca sotto il target")
}

// --- INTERFACCE PSICOLOGICHE ---
export interface AgentIdentity { selfImage: string; timeHorizon: string; archetype: string; }
export interface AgentBeliefs { trustInOthers: number; viewOfWorld: string; }
export interface AgentValues { wealth: number; fairness: number; stability: number; curiosity: number; }
export interface AgentRiskProfile { aversion: number; lossSensitivity: number; }

export interface PsychologicalProfile {
  identity: AgentIdentity;
  beliefs: AgentBeliefs;
  values: AgentValues;
  risk: AgentRiskProfile;
  resilience: number; 
  adaptability: number; 
}

export interface AgentMentalState {
  groupTrust: number;       
  optimism: number;         
  frustration: number;      
  recentVolatility: number; 
  consecutiveLosses: number;
  streakCounter: number;    
}

export interface Experience {
  game: string;
  round: number;
  choice: number;
  result: string;
  groupResult: string;
  profit: number;
  reasoning: string;
  timestamp: string;
  mentalSnapshot?: AgentMentalState;
}

// Memoria Statistica
interface ActionStat {
    timesChosen: number;
    totalProfit: number;
    avgProfit: number;
    wins: number;
    losses: number;
    winRate: number; 
}

interface GameStatsMap { [gameName: string]: { [choiceId: number]: ActionStat } }

export class Agent {
  account: Account;
  name: string;
  model: string;

  public profile: PsychologicalProfile;
  public mentalState: AgentMentalState;

  // 1. Memoria Sequenziale
  private history: Experience[] = [];

  // 2. Memoria Statistica (Performance Oggettiva)
  private performanceMemory: GameStatsMap = {};
  
  // 3. Memoria Vettoriale (RAG Narrativo)
  private memoryIndex: VectorStoreIndex | null = null;
  private storageDir: string;

  private filePath: string;
  private currentRoundMemory: { choice: number; reasoning: string } | null = null;

  constructor(account: Account, name: string, profile: PsychologicalProfile, model: string) {
    this.account = account;
    this.name = name;
    this.profile = profile;
    this.model = model;

    this.mentalState = {
        groupTrust: profile.beliefs.trustInOthers,
        optimism: 0.5 + (profile.resilience * 0.2) - (profile.risk.aversion * 0.1),
        frustration: 0.0,
        recentVolatility: 0.0,
        consecutiveLosses: 0,
        streakCounter: 0
    };

    const dataDir = path.join(process.cwd(), 'data', 'agents');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, `${this.name.replace(/\s+/g, '_')}.json`);
    
    this.storageDir = path.join(process.cwd(), 'data', 'vector_store', this.name.replace(/\s+/g, '_'));

    this.loadState();
  }

  // --- INIT ASINCRONO ---
  async initMemory() {
    try {
        if (!fs.existsSync(this.storageDir)) fs.mkdirSync(this.storageDir, { recursive: true });
        const storageContext = await storageContextFromDefaults({ persistDir: this.storageDir });
        try {
            this.memoryIndex = await VectorStoreIndex.init({ storageContext });
        } catch {
            this.memoryIndex = await VectorStoreIndex.fromDocuments([], { storageContext });
        }
    } catch (e) { console.error(`Errore init memory ${this.name}:`, e); }
  }

  // --- GETTER TEMPERATURA DINAMICA ---
  // Rende gli agenti "Yolo" più imprevedibili e quelli "Razio" più deterministici
  get dynamicTemperature(): number {
      if (this.profile.risk.aversion > 0.7) return 0.1; // Molto freddo/Razionale
      if (this.profile.risk.aversion < 0.3) return 0.9; // Molto caldo/Creativo
      return 0.7; // Default
  }

  // --- PLAY ROUND: IL CERVELLO GENERALE ---
  async playRound(
      gameName: string, 
      context: RoundContext // <--- QUI ARRIVA TUTTA L'INTELLIGENZA DEL GIOCO
    ): Promise<LLMDecision> {
    
    const p = this.profile;
    const m = this.mentalState;

    // A. Reality Check (Stats Personali)
    const statsSummary = this.getStatsSummary(gameName);

    // B. RAG Narrativo (Memoria Episodica)
    let relevantMemories = "Nessun ricordo specifico.";
    if (this.memoryIndex) {
        const retriever = this.memoryIndex.asRetriever({ similarityTopK: 3 });
        const query = `
            Gioco: ${gameName}. Obiettivo: Vincere.
            Quali strategie hanno funzionato in passato in contesti simili?
            Quali azioni hanno portato a perdite?
            Stato attuale: Frustrazione ${m.frustration.toFixed(2)}.
        `;
        const nodes = await retriever.retrieve(query);
        if (nodes.length > 0) relevantMemories = nodes.map(n => `• ${(n.node as TextNode).text}`).join("\n");
    }

    // C. COSTRUZIONE PROMPT (IL PRISMA)
    const cognitivePrompt = `
      SEI: ${this.name}.
      ARCHETIPO: ${p.identity.archetype} ("${p.identity.selfImage}").
      
      === CONTESTO DI GIOCO ===
      ${context.rules}
      
      === ANALISI DI MERCATO (DATI OGGETTIVI DAL GIOCO) ===
      Analisi: "${context.marketAnalysis}"
      Suggerimento Tattico: "${context.objectiveHint}"

      === I TUOI DATI STORICI ===
      ${statsSummary}

      === PROFILO E MEMORIA (IL TUO STATO INTERNO) ===
      Stato Mentale: [Ottimismo ${(m.optimism*10).toFixed(1)}/10] [Frustrazione ${(m.frustration*10).toFixed(1)}/10]
      Ricordi Rilevanti:
      ${relevantMemories}

      === MOTORE DECISIONALE (IL PRISMA) ===
      Tu NON devi seguire ciecamente il "Suggerimento Tattico". Devi filtrarlo attraverso il tuo ARCHETIPO:
      
      1. **SE SEI RAZIONALE (es. "The Computer", "Razio")**:
         - Segui la matematica e i dati di mercato alla lettera. Ottimizza per il profitto atteso.
         
      2. **SE SEI AGGRESSIVO/RISCHIOSO (es. "Yolo", "Trader")**:
         - Cerca di ANTICIPARE il mercato. Se il suggerimento dice "tutti vanno a destra", tu valuta di andare a sinistra per vincere tutto.
         - Non aver paura di fare mosse controintuitive se pensi di poter battere la massa.
         
      3. **SE SEI CONSERVATIVO/PAUROSO (es. "Saver", "Hope")**:
         - Cerca la sicurezza. Evita mosse che in passato ti hanno fatto perdere soldi, anche se il suggerimento dice di rischiare.
         - Segui il trend consolidato, non cercare di essere un eroe.
         
      4. **SE SEI EMOTIVO/TESTARDO (es. "Grudge")**:
         - Se la tua Frustrazione è alta (>7/10), potresti ignorare la logica e agire per ripicca o rabbia.
         
      === ISTRUZIONI FINALI ===
      - Leggi l'Analisi di Mercato.
      - Decidi come reagire in base al tuo Archetipo.
      - Genera una scelta JSON valida.

      Output JSON: { "choice": number, "reasoning": string }
    `;

    // Chiamata all'LLM con TEMPERATURA DINAMICA
    const decision = await askLLM(cognitivePrompt, this.model, { temperature: this.dynamicTemperature });
    
    this.currentRoundMemory = { ...decision };
    return decision;
  }

  // --- FINALIZE: AGGIORNAMENTO STATISTICO E NARRATIVO ---
  async finalizeRound(game: string, result: string, profit: number, groupResult: string, round: number) {
    if (!this.currentRoundMemory) return;

    const exp: Experience = {
      game, round, choice: this.currentRoundMemory.choice, reasoning: this.currentRoundMemory.reasoning,
      result, groupResult, profit, timestamp: new Date().toISOString(), mentalSnapshot: { ...this.mentalState }
    };
    
    // 1. History
    this.history.push(exp);

    // 2. Stats
    this.updatePerformanceMemory(game, exp.choice, profit, result);

    // 3. Mental State Logic (Matematica)
    this.updateMentalStateLogic(profit, result, groupResult, exp.choice);

    // 4. RAG (LlamaIndex)
    if (this.memoryIndex) {
        const memoryText = `
            Analisi Strategica ${game} (Round ${round}):
            Azione: ${exp.choice}.
            Risultato: ${profit.toFixed(2)} ALGO (${result}).
            Mercato: ${groupResult}.
            Stato Emotivo: Frustrazione ${(exp.mentalSnapshot?.frustration||0).toFixed(2)}.
            Conclusione: ${profit > 0 ? "Strategia Efficace." : "Strategia Inefficace."}
            Motivo: "${exp.reasoning}"
        `;
        const doc = new Document({ text: memoryText, metadata: { game, profit, result, choice: exp.choice } });
        await this.memoryIndex.insert(doc);
        
        // Persistenza manuale per sicurezza
        const ctx = this.memoryIndex.storageContext as any;
        if (ctx.docStore.persist) await ctx.docStore.persist(path.join(this.storageDir, "doc_store.json"));
        if (ctx.vectorStore.persist) await ctx.vectorStore.persist(path.join(this.storageDir, "vector_store.json"));
        if (ctx.indexStore.persist) await ctx.indexStore.persist(path.join(this.storageDir, "index_store.json"));
    }

    this.saveState();
    this.currentRoundMemory = null;
  }

  // --- UPDATE STATISTICS ---
  private updatePerformanceMemory(game: string, choice: number, profit: number, result: string) {
      if (!this.performanceMemory[game]) this.performanceMemory[game] = {};
      if (!this.performanceMemory[game][choice]) {
          this.performanceMemory[game][choice] = { timesChosen: 0, totalProfit: 0, avgProfit: 0, wins: 0, losses: 0, winRate: 0 };
      }
      const stat = this.performanceMemory[game][choice];
      stat.timesChosen++;
      stat.totalProfit += profit;
      stat.avgProfit = (stat.avgProfit * 0.7) + (profit * 0.3); // EMA
      if (result === 'WIN') stat.wins++; else if (result === 'LOSS') stat.losses++;
      stat.winRate = stat.wins / stat.timesChosen;
  }

  // --- HELPER STATS SUMMARY ---
  private getStatsSummary(game: string): string {
      const stats = this.performanceMemory[game];
      if (!stats) return "Nessun dato storico per questo gioco.";

      let summary = "Performance Storica Azioni:\n";
      Object.keys(stats).map(Number).sort((a,b) => stats[b].avgProfit - stats[a].avgProfit).forEach(choice => {
          const s = stats[choice];
          summary += `- Azione ${choice}: WinRate ${(s.winRate*100).toFixed(0)}%, Profitto ${s.avgProfit.toFixed(2)}\n`;
      });
      return summary;
  }

  // --- LOGICA MATEMATICA MENTALE (CON FIX STUBBORNNESS & BREAKEVEN) ---
  private updateMentalStateLogic(profit: number, result: string, groupResult: string, choice: number) {
    const p = this.profile;
    const m = this.mentalState;
    const learningRate = 0.15 * p.adaptability;
    const recoveryRate = 0.20 * p.resilience;
    
    // Dissipazione
    m.frustration *= 0.9;
    
    if (profit < 0) {
        // PERDITA
        m.consecutiveLosses++;
        
        // Controllo Testardaggine (Stubbornness)
        let isStubbornness = false;
        if (this.history.length >= 2) {
            const prev = this.history[this.history.length - 2];
            if (prev.profit < 0 && prev.choice === choice) isStubbornness = true;
        }

        let pain = Math.min(0.25, Math.abs(profit) * p.risk.lossSensitivity * 0.05);
        if (isStubbornness) { 
            pain *= 2.0; 
            m.optimism -= 0.1;
            console.log(`🧠 [${this.name}] Testardaggine punita.`);
        }
        if (p.resilience > 0.7) pain *= 0.6;
        
        m.frustration = Math.min(1.0, m.frustration + pain);
        m.optimism = Math.max(0.05, m.optimism - 0.05);
        
    } else if (profit > 0) {
        // VITTORIA
        m.consecutiveLosses = 0;
        const recoveryBoost = recoveryRate * (1 + p.resilience * 0.3);
        m.frustration = Math.max(0.0, m.frustration - recoveryBoost);
        m.optimism = Math.min(0.95, m.optimism + 0.1);
        
    } else {
        // PAREGGIO (BREAKEVEN)
        m.consecutiveLosses = 0;
        
        // Gestione aspettative
        if (m.optimism > 0.6) { // Si aspettava di vincere -> Delusione
            m.frustration += 0.05; m.optimism -= 0.05;
        } else if (m.optimism < 0.4) { // Si aspettava di perdere -> Sollievo
            m.frustration = Math.max(0, m.frustration - 0.05); m.optimism += 0.02;
        }
        
        // Gestione avidità
        if (p.values.wealth > 0.7) m.frustration += 0.03;
    }

    // Trust
    if (groupResult === 'WIN') m.groupTrust = Math.min(1.0, m.groupTrust + (learningRate * 1.2));
    else m.groupTrust = Math.max(0.0, m.groupTrust - learningRate);
    
    // Anti-Spirale
    if (m.consecutiveLosses >= 3 && p.adaptability > 0.5) {
        m.frustration *= 0.6; m.optimism = 0.5;
    }
  }

  // --- PERSISTENZA ---
  private loadState() {
    if (fs.existsSync(this.filePath)) {
      try { 
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.history = data.history || [];
        this.performanceMemory = data.performanceMemory || {}; 
        if (data.mentalState) this.mentalState = { ...this.mentalState, ...data.mentalState };
      } catch { this.history = []; this.performanceMemory = {}; }
    }
  }

  private saveState() {
    const data = { 
        name: this.name, 
        profile: this.profile, 
        mentalState: this.mentalState, 
        history: this.history,
        performanceMemory: this.performanceMemory 
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  public getLastMove(gameName: string): Experience | undefined {
    // Ritorna l'ultima esperienza di quel gioco
    return this.history.filter(h => h.game === gameName).pop();
}

  get signer(): TransactionSigner {
    return (txnGroup, indexes) => Promise.resolve(indexes.map(i => txnGroup[i].signTxn(this.account.sk)));
  }
}
