/* eslint-disable no-control-regex */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { z } from "zod";
import { Ollama } from 'ollama';
import JSON5 from 'json5';

const DecisionSchema = z.object({
  choice: z.coerce.number().int(), 
  reasoning: z.coerce.string().min(1), 
});

export type LLMDecision = z.infer<typeof DecisionSchema>;

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

export async function askLLM(prompt: string, model: string, options?: { temperature: number }): Promise<LLMDecision> {
  try {
    const response = await ollama.chat({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: options?.temperature ?? 0.7 },
      format: 'json', 
    });

    let raw = response.message.content.trim();

    // STRATEGIA 1: Pulizia markdown
    raw = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "");
    
    // STRATEGIA 2: Estrazione JSON con regex
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      raw = jsonMatch[0];
    }

    // STRATEGIA 3: Rimozione caratteri problematici
    raw = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

    let parsed;
    try {
      parsed = JSON5.parse(raw);
    } catch (e1) {
      // STRATEGIA 4: Fallback JSON standard
      try {
        parsed = JSON.parse(raw);
      } catch (e2) {
        // STRATEGIA 5: Estrazione manuale
        parsed = extractManually(raw);
        if (!parsed) {
          console.warn(`⚠️ Parsing fallito su: ${raw.substring(0, 100)}...`);
          throw new Error('All parsing strategies failed');
        }
      }
    }

    const validated = DecisionSchema.parse(parsed);
    return validated;

  } catch (error) {
    console.error(`❌ LLM parsing error:`, error);
    return {
      choice: 0,
      reasoning: "ERRORE PARSING: L'agente ha borbottato qualcosa di incomprensibile. Scelta di default.",
    };
  }
}

function extractManually(raw: string): any | null {
  try {
    // Cerca "choice" e "reasoning" con pattern flessibili
    const choiceMatch = raw.match(/["']?choice["']?\s*:\s*["']?(\d+)["']?/i);
    const reasoningMatch = raw.match(/["']?reasoning["']?\s*:\s*["']([^"']+)["']/i) ||
                          raw.match(/["']?reasoning["']?\s*:\s*([^,}\n]+)/i);

    if (choiceMatch) {
      const choice = parseInt(choiceMatch[1]);
      const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "No reasoning provided";
      
      return { choice, reasoning };
    }

    // Cerca array-style [choice, "reasoning"]
    const arrayMatch = raw.match(/\[\s*(\d+)\s*,\s*["']([^"']+)["']\s*\]/);
    if (arrayMatch) {
      return { choice: parseInt(arrayMatch[1]), reasoning: arrayMatch[2] };
    }

    return null;
  } catch (e) {
    return null;
  }
}
