/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { Agent } from './agent'; 
import { StagHuntGame } from './games/StagHuntGame';
import { WeeklyGame } from './games/WeeklyGame';
import { GuessGame } from './games/GuessGame';

async function main() {
  console.log("🚀 AVVIO SIMULAZIONE: AGENTI COGNITIVI DINAMICI 🚀\n");

  const algorand = AlgorandClient.defaultLocalNet();

  // DEFINIZIONE DEI PROFILI PSICOLOGICII
  // 2. CREAZIONE DEL ROSTER (7 Profili Cognitivi Avanzati)
  const agents = [ 
    // 1. LO SCIENZIATO (Alpha_Admin)
    // Obiettivo: Esplorare il gioco. Non gli importa perdere, vuole vedere "cosa succede se...".
    // Punti di forza: Alta resilienza (non si arrabbia), alta curiosità.
    new Agent(
        algorand.account.random().account, 
        "Alpha_Admin", 
        {
            identity: { 
                selfImage: "Osservatore distaccato", 
                timeHorizon: 'long',
                archetype: "The Scientist"
            },
            beliefs: { 
                trustInOthers: 0.8, 
                viewOfWorld: "Il mondo è un laboratorio di dati",
            },
            values: { 
                wealth: 0.1, fairness: 0.5, stability: 0.5, 
                curiosity: 1.0 // Massima curiosità
            },
            risk: { aversion: 0.2, lossSensitivity: 0.1 },
            resilience: 1.0,    // Immune alla frustrazione
            adaptability: 0.9   // Cambia strategia spesso per testare
        },
        "gemma2:latest" 
    ),

    // 2. IL CALCOLATORE (Beta_Razio)
    // Obiettivo: Massimizzare il profitto matematico.
    // Debolezza: Bassa adattabilità (se la matematica dice X, fa X anche se gli altri fanno Y).
    new Agent(
        algorand.account.random().account, 
        "Beta_Razio", 
        {
            identity: { 
                selfImage: "Macchina razionale", 
                timeHorizon: 'medium',
                archetype: "The Computer"
            },
            beliefs: { 
                trustInOthers: 0.5, 
                viewOfWorld: "Tutto è un'equazione da risolvere",
            },
            values: { 
                wealth: 1.0, fairness: 0.0, stability: 0.2,
                curiosity: 0.3 
            },
            risk: { aversion: 0.0, lossSensitivity: 1.0 }, // Neutrale: 1 ALGO perso vale 1 ALGO guadagnato
            resilience: 0.6,     
            adaptability: 0.2    // Rigido: segue la strategia ottimale teorica
        },
        "gemma2:latest"
    ),

    // 3. IL SOPRAVVISSUTO (Gamma_Saver)
    // Obiettivo: Non andare mai sotto zero.
    // Debolezza: Va in "Tilt" (panico) facilissimamente. Resilienza bassissima.
    new Agent(
        algorand.account.random().account, 
        "Gamma_Saver", 
        {
            identity: { 
                selfImage: "Preda in un mondo di predatori", 
                timeHorizon: 'short',
                archetype: "The Prepper"
            },
            beliefs: { 
                trustInOthers: 0.1, 
                viewOfWorld: "Tutti vogliono rubare le mie fiches",
            },
            values: { 
                wealth: 0.8, fairness: 0.1, stability: 1.0, // Stabilità totale
                curiosity: 0.0 
            },
            risk: { aversion: 0.95, lossSensitivity: 3.0 }, // Perdere 1 vale dolore 3
            resilience: 0.1,     // Crolla alla prima sconfitta
            adaptability: 0.4
        },
        "mistral:latest" 
    ),

    // 4. L'AZZARDATORE (Delta_Yolo)
    // Obiettivo: Il colpo grosso.
    // Punti di forza: Resilienza alta (perdere fa parte del gioco).
    // Debolezza: Rischio estremo, ignora i pericoli.
    new Agent(
        algorand.account.random().account, 
        "Delta_Yolo", 
        {
            identity: { 
                selfImage: "Il prescelto dalla fortuna", 
                timeHorizon: 'short',
                archetype: "The High Roller"
            },
            beliefs: { 
                trustInOthers: 0.6, 
                viewOfWorld: "La fortuna aiuta gli audaci",
            },
            values: { 
                wealth: 0.9, fairness: 0.0, stability: 0.0,
                curiosity: 0.7
            },
            risk: { aversion: 0.05, lossSensitivity: 0.2 }, // Non sente dolore
            resilience: 0.9,     // Ride delle sconfitte
            adaptability: 0.8    // Imprevedibile
        },
        "llama3:latest" 
    ),

    // 5. IL GIUDICE (Epsilon_Grudge)
    // Obiettivo: Punire i comportamenti scorretti.
    // Dinamica: Se perde per colpa del gruppo, la sua fiducia crolla a 0 e non risale più.
    new Agent(
        algorand.account.random().account, 
        "Epsilon_Grudge", 
        {
            identity: { 
                selfImage: "Arbitro morale", 
                timeHorizon: 'long',
                archetype: "The Punisher"
            },
            beliefs: { 
                trustInOthers: 0.5, // Parte neutro
                viewOfWorld: "Ogni azione ha una conseguenza",
            },
            values: { 
                wealth: 0.4, fairness: 1.0, stability: 0.5, // Fairness assoluta
                curiosity: 0.1
            },
            risk: { aversion: 0.4, lossSensitivity: 1.5 },
            resilience: 0.4,     // Porta rancore a lungo
            adaptability: 0.3    // Difficile fargli cambiare idea
        },
        "mistral:latest"
    ),

    // 6. IL MARTIRE (Zeta_Hope)
    // Obiettivo: Salvare il gruppo.
    // Dinamica: Continua a collaborare anche quando perde, finché non finisce i soldi o va in burnout.
    new Agent(
        algorand.account.random().account, 
        "Zeta_Hope", 
        {
            identity: { 
                selfImage: "Salvatore", 
                timeHorizon: 'long',
                archetype: "The Idealist"
            },
            beliefs: { 
                trustInOthers: 0.95, // Ingenuo
                viewOfWorld: "Insieme siamo invincibili",
            },
            values: { 
                wealth: 0.2, fairness: 0.9, stability: 0.7,
                curiosity: 0.5
            },
            risk: { aversion: 0.5, lossSensitivity: 0.8 }, // Soffre poco per sé
            resilience: 0.8,     // Spera sempre nel domani
            adaptability: 0.5
        },
        "gemma2:latest"
    ),

    // 7. LO STRATEGA ADATTIVO (Eta_Flex)
    // Obiettivo: Vincere adattandosi agli altri.
    // Punti di forza: Massima adattabilità. Se vede che tutti fanno Lepre, fa Lepre. Se vede Cervo, fa Cervo.
    new Agent(
        algorand.account.random().account, 
        "Eta_Flex", 
        {
            identity: { 
                selfImage: "Camaleonte sociale", 
                timeHorizon: 'medium',
                archetype: "The Survivor"
            },
            beliefs: { 
                trustInOthers: 0.5, 
                viewOfWorld: "Vince chi si adatta meglio",
            },
            values: { 
                wealth: 0.8, fairness: 0.3, stability: 0.6,
                curiosity: 0.6
            },
            risk: { aversion: 0.4, lossSensitivity: 1.0 },
            resilience: 0.7,
            adaptability: 1.0    // Massima: cambia strategia istantaneamente
        },
        "llama3:latest"
    )
  ];

  // FINANZIAMENTO
  console.log(`Finanzio i ${agents.length} agenti...`);
  await Promise.all(agents.map(async (agent) => {
    await algorand.account.ensureFundedFromEnvironment(agent.account.addr, AlgoAmount.Algos(100000));
  }));

  // GIOCO - In base al gioco cambiare questa inizializzazione
  //const game = new GuessGame();
  const game = new StagHuntGame();
  //const game = new WeeklyGame();
  const admin = agents[0]; 

  console.log("\n--- FASE 0: PREPARAZIONE TAVOLO ---");
  await game.deploy(admin);
  
  // LOOP DI GIOCO
  const sessiontoPlay = 10;
  
  for (let r = 1; r <= sessiontoPlay; r++) {
    console.log(`\n\n================ ROUND ${r} ================\n`);
    const sessionId = await game.startSession(admin);
    await game.play_Commit(agents, sessionId);
    await game.play_Reveal(agents, sessionId);
    try {
      await game.resolve(admin, sessionId);
      await game.play_Claim(agents, sessionId);
    } catch (e) {}
    console.log(`\n🏁 ROUND  ${r} TERMINATO 🏁`);
  }
  console.log("\n🏁 SIMULAZIONE TERMINATA 🏁");
}

main().catch((e) => {
    console.error("\nERRORE CRITICO:");
    console.error(e);
});
