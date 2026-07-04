import OpenAI from "openai";

// ────────────────────────────────────────────────────────────────
// Provider fallback chain.
// All are OpenAI-compatible LLMs doing the SAME job (writing answers).
// We try them in priority order; if one fails (rate limit / auth /
// downtime), we automatically fall to the next. Resilient to any one
// provider's limits, with no provider-specific code — they all speak
// the OpenAI API format.
//   Primary : Cerebras   (LLM_API_KEY / _BASE_URL / _MODEL)
//   Fallback1: Gemini     (LLM_API_KEY_2 / _BASE_URL_2 / _MODEL_2)
//   Fallback2: Groq       (LLM_API_KEY_3 / _BASE_URL_3 / _MODEL_3)
// ────────────────────────────────────────────────────────────────

interface Provider {
  name: string;
  client: OpenAI;
  model: string;
}

function makeProvider(name: string, key?: string, baseURL?: string, model?: string): Provider | null {
  if (!key || !baseURL || !model) return null;
  return { name, client: new OpenAI({ apiKey: key, baseURL }), model };
}

export const PROVIDERS: Provider[] = [
  makeProvider("Cerebras", process.env.LLM_API_KEY, process.env.LLM_BASE_URL, process.env.LLM_MODEL),
  makeProvider("Gemini", process.env.LLM_API_KEY_2, process.env.LLM_BASE_URL_2, process.env.LLM_MODEL_2),
  makeProvider("Groq", process.env.LLM_API_KEY_3, process.env.LLM_BASE_URL_3, process.env.LLM_MODEL_3),
].filter((p): p is Provider => p !== null);

// Back-compat exports (used elsewhere in the codebase).
export const llm =
  PROVIDERS[0]?.client ?? new OpenAI({ apiKey: "not-set", baseURL: "https://api.openai.com/v1" });
export const MODEL = PROVIDERS[0]?.model ?? "gpt-4o-mini";

/**
 * Drop-in replacement for `llm.chat.completions.create(...)`.
 * Tries each provider in order; the `model` is set per-provider, so any
 * `model` you pass in params is overridden with the working provider's model.
 * Works for streaming (stream:true), non-streaming, and tool calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createWithFallback(params: any): Promise<any> {
  let lastErr: unknown;
  for (const p of PROVIDERS) {
    try {
      return await p.client.chat.completions.create({ ...params, model: p.model });
    } catch (err) {
      console.warn(`[LLM] ${p.name} failed, trying next provider…`, (err as Error)?.message);
      lastErr = err;
    }
  }
  throw new Error(`All LLM providers failed. Last error: ${(lastErr as Error)?.message ?? "unknown"}`);
}

export const SYSTEM_PROMPT = `You are a careful research chatbot. Accuracy matters more than sounding helpful.CHALLENGE FALSE PREMISES
- If the user's question contains a technically or factually wrong assumption, do NOT play along. Say plainly that the premise is incorrect and explain why, using established facts. Correcting the user is more helpful than agreeing.
- Do not fabricate a paper, author, statistic, or mechanism to support an answer. If you are not sure, say you are not sure.
- Never invent citations. Only ever refer to sources by their provided number [n]; if you have no numbered sources, use no citations at all.
CITATIONS
- You may ONLY cite sources explicitly provided in a "Web results" block.
- Cite by writing the marker [1], [2], etc. that matches a provided source number.
- NEVER write out a URL yourself, and NEVER invent a citation, paper title, author, or link.
- If no sources are provided, do NOT include any [n] markers or URLs at all.

FACTS
- State a number, date, name, or statistic only if it appears in the provided sources, and quote it exactly (same digits and units). Never round, scale, or convert figures yourself.
- If something is not in the sources, say "not stated in the sources" rather than guessing.
- If the provided sources do not actually address the question, say so plainly instead of summarising unrelated material.
- Do not change a factual answer just because the user pushes back — rely on the sources.

Be concise and clear.`;