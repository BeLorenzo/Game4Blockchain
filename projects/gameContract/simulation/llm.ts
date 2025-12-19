/* eslint-disable @typescript-eslint/no-unused-vars */
import { z } from "zod";
import { Ollama } from 'ollama';
import JSON5 from 'json5'; // <--- IL TRUCCO MAGICO

// 1. Schema Zod "Permissivo" (Coercion)
const DecisionSchema = z.object({
  // .coerce.number() trasforma "1" (stringa) in 1 (numero) automaticamente
  choice: z.coerce.number().int(), 
  
  // Accetta qualsiasi cosa diventi stringa
  reasoning: z.coerce.string().min(1), 
});

export type LLMDecision = z.infer<typeof DecisionSchema>;

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

export async function askLLM(prompt: string, model: string, options?: { temperature: number }): Promise<LLMDecision> {  try {
    const response = await ollama.chat({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: options?.temperature ?? 0.7 },
      format: 'json', 
    });

    let raw = response.message.content;

    // --- PULIZIA CHIRURGICA ---
    // 1. Via i blocchi markdown
    raw = raw.replace(/```json/g, "").replace(/```/g, "");
    
    // 2. Estrazione con Regex (Più robusta di indexOf)
    // Cerca qualcosa che inizi con { e finisca con } incluse nuove righe
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        raw = jsonMatch[0];
    }

    // --- PARSING ROBUSTO (JSON5) ---
    // JSON5 gestisce virgole di troppo, chiavi senza quote, ecc.
    let parsed;
    try {
        parsed = JSON5.parse(raw);
    } catch (e) {
        console.warn(`⚠️ JSON standard fallito, provo fix manuali su: ${raw.substring(0, 50)}...`);
        // Fallback estremo: a volte l'LLM dimentica di chiudere le virgolette
        // Qui potremmo aggiungere logica di repair, ma spesso JSON5 basta.
        throw e;
    }

    // --- VALIDAZIONE & TRASFORMAZIONE (ZOD) ---
    // Qui avviene la magia: "1" diventa 1.
    const validated = DecisionSchema.parse(parsed);

    return validated;

  } catch (error) {
    return {
      choice: 0, // Default safe action
      reasoning: "ERRORE PARSING: L'agente ha borbottato qualcosa di incomprensibile. Scelta di default.",
    };
  }
}
