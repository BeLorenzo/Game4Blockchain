/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-control-regex */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { Ollama } from 'ollama';
import JSON5 from 'json5';

// Schema base che ogni risposta deve avere
export const BaseDecisionSchema = z.object({
  choice: z.coerce.number().int(), 
  reasoning: z.coerce.string().min(1), 
});

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

/**
 * Funzione generica per interrogare l'LLM
 * @param T lo schema Zod per validare la risposta
 */
export async function askLLM<T extends z.ZodTypeAny>(
  prompt: string, 
  model: string, 
  schema: T, 
  options?: { temperature: number }
): Promise<z.infer<T>> {
  
  let raw = ""; 
  try {
    const response = await ollama.chat({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: options?.temperature ?? 0.7 },
      format: 'json', 
    });

    raw = response.message.content.trim();

    // 1. Pulizia chirurgica (Markdown & Braces)
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      raw = raw.substring(firstBrace, lastBrace + 1);
    }

    // 2. Rimozione caratteri di controllo invisibili
    raw = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

    let parsed: any;
    try {
      parsed = JSON5.parse(raw);
    } catch (e1) {
      try {
        parsed = JSON.parse(raw);
      } catch (e2) {
        // 3. Fallback: Estrazione manuale se il JSON è malformato
        parsed = extractManually(raw);
        if (!parsed) throw new Error(`Parsing failed entirely.`);
      }
    }

    // 4. Validazione con lo schema passato (torna il tipo corretto T)
    return schema.parse(parsed);

  } catch (error) {
    console.error(`❌ LLM ERROR:\nRaw Response: "${raw}"\nError:`, error);
    
    // Ritorna un oggetto di fallback che rispetti lo schema base
    // Nota: se lo schema T ha campi obbligatori extra (come 'distribution'), 
    // questo fallback potrebbe fallire la validazione di Zod, il che è corretto.
    return {
      choice: 0,
      reasoning: "ERRORE PARSING: L'agente ha rotto il formato. Controlla i log.",
    } as z.infer<T>;
  }
}

/**
 * Tenta di recuperare choice e reasoning da una stringa sporca tramite Regex
 */
function extractManually(raw: string): any | null {
  try {
    const choiceMatch = raw.match(/"choice"\s*:\s*(\d+)/);
    const choice = choiceMatch ? parseInt(choiceMatch[1]) : 0;

    let reasoning = "No reasoning extracted";
    // Tenta virgolette doppie o singole
    const resMatch = raw.match(/"reasoning"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/) || 
                     raw.match(/'reasoning'\s*:\s*'([\s\S]*?)'(?=\s*[,}])/);
    
    if (resMatch) reasoning = resMatch[1];

    return { choice, reasoning };
  } catch (e) {
    return null;
  }
}
