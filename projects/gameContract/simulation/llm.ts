/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-control-regex */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { Ollama } from 'ollama';
import JSON5 from 'json5';

/**
 * Base schema enforced for all agent responses.
 * Ensures every decision has a numeric choice and a text reasoning.
 */
export const BaseDecisionSchema = z.object({
  choice: z.coerce.number().int(), 
  reasoning: z.coerce.string().min(1), 
});

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

/**
 * Generic wrapper to query the Local LLM (Ollama).
 * Handles raw string cleaning, JSON parsing (with fault tolerance), and Zod validation.
 * @param prompt - The full prompt string sent to the model.
 * @param model - The model identifier (e.g., 'llama3').
 * @param schema - The Zod schema to validate the response against.
 * @param options - Configuration options (e.g., temperature).
 * @returns The parsed and validated object matching schema T.
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

    // 1. Surgical cleanup (Remove Markdown blocks & surrounding text)
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      raw = raw.substring(firstBrace, lastBrace + 1);
    }

    // 2. Remove invisible control characters that break JSON.parse
    raw = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

    let parsed: any;
    try {
      // Try JSON5 first (more permissive with trailing commas/quotes)
      parsed = JSON5.parse(raw);
    } catch (e1) {
      try {
        // Fallback to standard JSON
        parsed = JSON.parse(raw);
      } catch (e2) {
        // 3. Last Resort: Manual extraction via Regex if JSON structure is broken
        parsed = extractManually(raw);
        if (!parsed) throw new Error(`Parsing failed entirely.`);
      }
    }

    // 4. Validate against the provided Zod schema
    return schema.parse(parsed);

  } catch (error) {
    console.error(`❌ LLM ERROR:\nRaw Response: "${raw}"\nError:`, error);
    
    // Return a safety fallback compliant with the Base Schema.
    // WARNING: If schema T requires extra fields (e.g., 'distribution'), this might fail downstream validation.
    return {
      choice: 0,
      reasoning: "PARSING ERROR: Agent broke the format format. Check logs.",
    } as z.infer<T>;
  }
}

/**
 * Attempts to salvage 'choice' and 'reasoning' from a malformed string using Regex.
 * Useful when the LLM outputs invalid JSON (e.g., missing braces or unescaped quotes).
 */
function extractManually(raw: string): any | null {
  try {
    const choiceMatch = raw.match(/"choice"\s*:\s*(\d+)/);
    const choice = choiceMatch ? parseInt(choiceMatch[1]) : 0;

    let reasoning = "No reasoning extracted";
    
    // Attempt to match reasoning content within double or single quotes
    const resMatch = raw.match(/"reasoning"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/) || 
                     raw.match(/'reasoning'\s*:\s*'([\s\S]*?)'(?=\s*[,}])/);
    
    if (resMatch) reasoning = resMatch[1];

    return { choice, reasoning };
  } catch (e) {
    return null;
  }
}
