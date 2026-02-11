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

/**
 * Ollama client instance for interacting with local LLM.
 * Configured to connect to the default Ollama server at localhost:11434.
 */
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

/**
 * Generic wrapper to query the Local LLM (Ollama).
 * Handles raw string cleaning, JSON parsing (with fault tolerance), and Zod validation.
 * 
 * The function performs the following steps:
 * 1. Sends the prompt to the specified Ollama model
 * 2. Cleans the raw response (removes markdown, control characters)
 * 3. Attempts parsing with JSON5 (lenient), then standard JSON, then regex extraction
 * 4. Validates the parsed object against the provided Zod schema
 * 5. Returns a safe fallback if all parsing attempts fail
 * 
 * @example
 * const result = await askLLM(prompt, 'llama3', MySchema, { temperature: 0.7 });
 */
export async function askLLM<T extends z.ZodTypeAny>(
  prompt: string, 
  model: string, 
  schema: T, 
  options?: { temperature: number }
): Promise<z.infer<T>> {
  
  let raw = ""; 
  try {
    // Make the LLM API call
    const response = await ollama.chat({
      model: model,
      messages: [
        { 
          role: 'system', 
          content: 'You are an intelligent agent running in a simulation. You output ONLY valid JSON. You do not explain, you do not apologize, you just output the data.' 
        },
        { role: 'user', content: prompt }
      ],
      options: {
        temperature: options?.temperature ?? 0.4,    
        num_ctx: 8192,       
        num_predict: 500,    
      },
    });

    raw = response.message.content.trim();

    // === 1. SURGICAL CLEANUP ===
    // Remove Markdown blocks and surrounding text, extract only JSON content
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      raw = raw.substring(firstBrace, lastBrace + 1);
    }

    // === 2. REMOVE CONTROL CHARACTERS ===
    // Eliminate invisible characters that break JSON.parse
    raw = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

    let parsed: any;
    try {
      // === 3. ATTEMPT JSON5 PARSING (LENIENT) ===
      // JSON5 handles trailing commas, unquoted keys, comments, etc.
      parsed = JSON5.parse(raw);
    } catch (e1) {
      try {
        // === 4. FALLBACK TO STANDARD JSON ===
        parsed = JSON.parse(raw);
      } catch (e2) {
        // === 5. LAST RESORT: MANUAL REGEX EXTRACTION ===
        // Used when JSON structure is severely broken
        parsed = extractManually(raw);
        if (!parsed) throw new Error(`Parsing failed entirely.`);
      }
    }

    // === 6. ZOD VALIDATION ===
    // Ensure the parsed object conforms to the expected schema
    return schema.parse(parsed);

  } catch (error) {
    // Log detailed error information for debugging
    console.error(`❌ LLM ERROR:\nRaw Response: "${raw}"\nError:`, error);
    
    /**
     * SAFETY FALLBACK
     * Returns a minimal valid object to prevent complete system failure.
     * WARNING: If schema T requires extra fields (e.g., 'distribution'), 
     * this might fail downstream validation.
     */
    return {
      choice: 0,
      reasoning: "PARSING ERROR: Agent broke the format format. Check logs.",
    } as z.infer<T>;
  }
}

/**
 * Attempts to salvage 'choice' and 'reasoning' from a malformed string using Regex.
 * Useful when the LLM outputs invalid JSON (e.g., missing braces or unescaped quotes).
 * 
 * Extraction patterns:
 * 1. `choice`: Matches "choice": followed by digits
 * 2. `reasoning`: Matches "reasoning": followed by quoted text (double or single quotes)
 */
function extractManually(raw: string): any | null {
  try {
    // Extract choice using regex for "choice": digits
    const choiceMatch = raw.match(/"choice"\s*:\s*(\d+)/);
    const choice = choiceMatch ? parseInt(choiceMatch[1]) : 0;

    // Initialize with default reasoning
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