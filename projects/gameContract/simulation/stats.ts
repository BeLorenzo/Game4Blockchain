/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-control-regex */
import * as fs from 'fs';
import * as path from 'path';

// --- INTERFACCE ---
interface HistoryItem {
    game: string;
    round: number;
    choice: number;
    result: string;
    profit: number;
    timestamp: string;
}

interface MentalState {
    groupTrust: number;
    optimism: number;
    frustration: number;
}

interface AgentData {
    name: string;
    profile: {
        identity: { archetype: string };
    };
    mentalState: MentalState;
    history: HistoryItem[];
}

interface AgentSummary {
    Agent: string;
    Archetype: string;
    'Games': number;
    'Win %': string;
    'Profit': string;
    'Trust': string;
    'Mood': string;
}

// --- COLORI ANSI ---
const R = "\x1b[0m"; // Reset
const G = "\x1b[32m"; // Green
const E = "\x1b[31m"; // Red (Error/Loss)
const Y = "\x1b[33m"; // Yellow
const B = "\x1b[1m";  // Bold
const C = "\x1b[36m"; // Cyan
const M = "\x1b[35m"; // Magenta
const DIM = "\x1b[2m";

// --- MAPPE VISIVE ---
const STAG_ICONS: Record<number, string> = { 1: '🦌', 0: '🐇' };
const WEEKLY_ICONS: Record<number, string> = { 0: 'Lun', 1: 'Mar', 2: 'Mer', 3: 'Gio', 4: 'Ven', 5: 'Sab', 6: 'Dom' };

async function main() {
    let files = process.argv.slice(2);
    if (files.length === 0) {
        const defaultDir = path.join(process.cwd(), 'data', 'agents');
        if (fs.existsSync(defaultDir)) {
            files = fs.readdirSync(defaultDir).filter((f: string) => f.endsWith('.json')).map((f: any) => path.join(defaultDir, f));
        }
    }

    if (files.length === 0) return console.log(Y + "⚠️ Nessun file trovato." + R);

    const agents: AgentData[] = [];
    files.forEach((f: any) => {
        try { agents.push(JSON.parse(fs.readFileSync(f, 'utf-8'))); } catch (e) {}
    });

    printSummaryTable(agents);
    printChronologicalTimeline(agents);
    printDetailedGameStats(agents);
}

// --- 2. TIMELINE CRONOLOGICA ---
function printChronologicalTimeline(agents: AgentData[]) {
    console.log(`\n${C}${B}🎞️  TIMELINE DELLE PARTITE (Sequenza Temporale)${R}`);
    
    const allGames = new Set<string>();
    agents.forEach(a => a.history.forEach(h => allGames.add(h.game)));

    for (const game of allGames) {
        console.log(`\n🔸 ${B}GIOCO: ${game.toUpperCase()}${R}`);
        
        let maxMatches = 0;
        agents.forEach(a => {
            const matchCount = a.history.filter(h => h.game === game).length;
            maxMatches = Math.max(maxMatches, matchCount);
        });

        if (maxMatches === 0) continue;

        let header = "Agent".padEnd(16) + "| ";
        for (let i = 1; i <= maxMatches; i++) header += `P${i}`.padEnd(5);
        console.log(DIM + header + R);
        console.log(DIM + "-".repeat(header.length) + R);

        for (const agent of agents) {
            let row = agent.name.padEnd(16) + "| ";
            const agentMatches = agent.history.filter(h => h.game === game);

            for (let i = 0; i < maxMatches; i++) {
                const move = agentMatches[i];
                if (move) {
                    let symbol = String(move.choice);
                    
                    if (game === 'StagHunt') symbol = STAG_ICONS[move.choice] || symbol;
                    if (game === 'WeeklyGame') symbol = WEEKLY_ICONS[move.choice] || symbol;
                    // GuessGame: Lasciamo il numero puro (es. 33)
                    
                    let coloredSymbol = symbol;
                    if (move.result === 'WIN') coloredSymbol = G + symbol + R;
                    else if (move.result === 'LOSS') coloredSymbol = E + symbol + R;
                    else coloredSymbol = Y + symbol + R;

                    row += coloredSymbol.padEnd(14); 
                } else {
                    row += DIM + "-".padEnd(5) + R;
                }
            }
            console.log(row);
        }
    }
}

// --- 3. STATISTICHE DETTAGLIATE (GuessGame Logic Updated) ---
function printDetailedGameStats(agents: AgentData[]) {
    console.log(`\n${M}${B}📈 STATISTICHE APPROFONDITE PER GIOCO${R}`);
    
    const allGames = new Set<string>();
    agents.forEach(a => a.history.forEach(h => allGames.add(h.game)));

    for (const game of allGames) {
        console.log(`\n🔹 ${B}ANALISI: ${game.toUpperCase()}${R}`);
        
        // Determiniamo quante partite sono state giocate in totale
        let maxMatches = 0;
        agents.forEach(a => {
            maxMatches = Math.max(maxMatches, a.history.filter(h => h.game === game).length);
        });

        if (game === 'GuessGame') {
            console.log(DIM + "Obiettivo: Indovinare i 2/3 della media. (Target Ideale: 0)" + R);
            console.log("Match | Media Scelte | Target (2/3) | Vincitore (Scelta)");
            console.log("-".repeat(60));

            // Analisi per ogni singola partita (P1, P2, P3...)
            for (let i = 0; i < maxMatches; i++) {
                const matchChoices: { agent: string, choice: number, profit: number }[] = [];
                
                // Raccogli le scelte di tutti gli agenti per la partita 'i'
                agents.forEach(a => {
                    const matches = a.history.filter(h => h.game === game);
                    if (matches[i]) {
                        matchChoices.push({ 
                            agent: a.name, 
                            choice: matches[i].choice,
                            profit: matches[i].profit
                        });
                    }
                });

                if (matchChoices.length === 0) continue;

                const sum = matchChoices.reduce((acc, curr) => acc + curr.choice, 0);
                const avg = sum / matchChoices.length;
                const target = avg * (2/3);

                // Trova chi ha vinto (chi ha fatto profitto > 0)
                const winners = matchChoices.filter(c => c.profit > 0);
                const winnerText = winners.length > 0 
                    ? `${winners[0].agent.substring(0,10)} (${winners[0].choice})`
                    : "Nessuno";

                // Colora il target per vedere se scende (verde) o sale (rosso) rispetto a 50
                const targetColor = target < 33 ? G : (target > 60 ? E : Y);

                console.log(
                    `P${i+1}`.padEnd(6) + "| " + 
                    `${avg.toFixed(2)}`.padEnd(13) + "| " + 
                    `${targetColor}${target.toFixed(2)}${R}`.padEnd(22) + "| " + 
                    winnerText
                );
            }

        } else {
            // --- LOGICA CATEGORICA (StagHunt / Weekly) ---
            const allChoices: number[] = [];
            agents.forEach(a => a.history.filter(h => h.game === game).forEach(h => allChoices.push(h.choice)));

            const counts: Record<string, number> = {};
            allChoices.forEach(c => {
                let label = String(c);
                if (game === 'StagHunt') label = STAG_ICONS[c] ? `${STAG_ICONS[c]} (${c})` : label;
                if (game === 'WeeklyGame') label = WEEKLY_ICONS[c] ? `${WEEKLY_ICONS[c]}` : label;
                counts[label] = (counts[label] || 0) + 1;
            });

            // Ordina per frequenza
            Object.entries(counts)
                .sort(([,a], [,b]) => b - a)
                .forEach(([label, count]) => {
                    const bar = "█".repeat(count);
                    const percentage = ((count / allChoices.length) * 100).toFixed(1);
                    console.log(`   ${label.padEnd(10)}: ${bar} ${count} (${percentage}%)`);
                });
        }
    }
    console.log("\n");
}

// --- 1. TABELLA RIEPILOGATIVA ---
function printSummaryTable(agents: AgentData[]) {
    const table: AgentSummary[] = [];
    console.log(`\n${B}📊 CLASSIFICA GENERALE${R}\n`);

    for (const data of agents) {
        const totalProfit = data.history.reduce((sum, h) => sum + h.profit, 0);
        const wins = data.history.filter(h => h.result === 'WIN').length;
        const totalGames = data.history.length;
        
        const m = data.mentalState;
        let mood = '😐';
        if (m.frustration > 0.6) mood = '😡';
        else if (m.optimism > 0.7) mood = '🤩';
        else if (m.optimism < 0.3) mood = '😨';

        const profitColor = totalProfit >= 0 ? G : E;

        table.push({
            'Agent': B + data.name + R,
            'Archetype': data.profile.identity.archetype,
            'Games': totalGames,
            'Win %': totalGames > 0 ? ((wins/totalGames)*100).toFixed(0) + '%' : '0%',
            'Profit': profitColor + totalProfit.toFixed(2) + R,
            'Trust': (m.groupTrust * 10).toFixed(1),
            'Mood': mood
        });
    }
    
    const headers = Object.keys(table[0]);
    const widths = headers.map(h => 12);
    widths[0] = 16; 

    let headRow = "";
    headers.forEach((h, i) => headRow += h.padEnd(widths[i]));
    console.log(headRow);
    console.log(DIM + "-".repeat(headRow.length) + R);

    table.sort((a,b) => parseFloat(strip(b.Profit)) - parseFloat(strip(a.Profit)));

    table.forEach(row => {
        let rStr = "";
        headers.forEach((h, i) => {
            const val = String((row as any)[h]);
            const realLen = strip(val).length;
            const pad = widths[i] - realLen;
            rStr += val + " ".repeat(Math.max(0, pad));
        });
        console.log(rStr);
    });
}

function strip(str: string) { return str.replace(/\x1b\[[0-9;]*m/g, ''); }

main().catch(console.error);
