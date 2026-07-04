import { MODEL, SYSTEM_PROMPT, createWithFallback } from "@/lib/llm";
import { searchWeb } from "@/lib/search";
import { readSources } from "@/lib/scrape";
import type { ChatMessage, Source, StreamEvent, WebMode } from "@/lib/types";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

export const runtime = "nodejs";
export const maxDuration = 60; // research turns can be slow; raise on self-host

// Remove any citation the model invents. It may ONLY reference sources by the
// provided numbers [1..maxId]. Everything else — bare URLs, [n] beyond the real
// count, and inline "Author, A. (2023). Title. arXiv:1234.5678" style refs — is
// stripped. Deterministic: prompts can be ignored, this cannot.
function stripFakeCitations(text: string, maxId = 0): string {
  let out = text
    .replace(/\b(?:arxiv|doi)\s*:\s*\S+/gi, "") // fabricated arXiv/doi refs
    .replace(/\bhttps?:\/\/\S+/gi, "");         // bare URLs

  // keep [n] only when it points at a real source; drop the rest
  out = out.replace(/\[(\d+)\]/g, (m, n) =>
    Number(n) >= 1 && Number(n) <= maxId ? m : ""
  );

  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const searchTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_web",
    description:
      "Search the web and read pages when you need current, factual, or specific information you cannot answer reliably from memory.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A focused search query." },
      },
      required: ["query"],
    },
  },
};

// ── Chat-with-a-URL helpers ──────────────────────────────────────────────
// Fetches a single page directly (bypassing search) and turns it into both
// a Source (for the UI card) and plain text (for the model's context).
// Self-contained on purpose: it doesn't depend on lib/scrape's internals,
// which are tuned for search-result pages and may assume a search query.

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractTextFromHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

class FetchUrlError extends Error {}

// Fires one small extra LLM call after an answer to suggest 2-3 natural
// follow-up questions. Best-effort: any failure just yields no suggestions
// rather than breaking the response.
async function generateFollowups(question: string, answer: string): Promise<string[]> {
  if (!answer || answer.trim().length < 20) return [];
  try {
    const resp = await createWithFallback({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "Given a user's question and the assistant's answer, suggest exactly 3 short, " +
            "natural follow-up questions the user might ask next. Keep each under 12 words. " +
            'Respond with ONLY a JSON array of 3 strings, nothing else — e.g. ["...", "...", "..."].',
        },
        {
          role: "user",
          content: `Question: ${question}\n\nAnswer: ${answer.slice(0, 4000)}`,
        },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "[]";
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 3);
  } catch {
    return [];
  }
}

async function fetchUrlAsSource(rawUrl: string): Promise<{ source: Source; text: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new FetchUrlError("That doesn't look like a valid URL.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new FetchUrlError("Only http(s) URLs are supported.");
  }

  const res = await fetch(parsed.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; WebReaderBot/1.0; +chat-with-url)" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new FetchUrlError(`The page returned an error (status ${res.status}).`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text")) {
    throw new FetchUrlError("That link doesn't point to a readable web page.");
  }

  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : parsed.hostname;

  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const description = descMatch ? decodeHtmlEntities(descMatch[1].trim()) : "";

  const text = extractTextFromHtml(html);
  const domain = parsed.hostname.replace(/^www\./, "");

  if (text.length < 40) {
    throw new FetchUrlError("Couldn't extract readable text from that page (it may require JavaScript).");
  }

  const source: Source = {
    id: 1,
    url: parsed.toString(),
    title: title || domain,
    domain,
    favicon: `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
    snippet: description || text.slice(0, 220),
    // NOTE: adjust field names here if lib/credibility's `Credibility` type differs.
    credibility: {
      tier: "medium",
      label: "Direct link",
      score: 50,
      reasons: ["Fetched directly from the URL you provided, not independently verified"],
    },
  };

  // cap what we send to the model — plenty for a single article/page
  return { source, text: text.slice(0, 14000) };
}

export async function POST(req: Request) {
    const { messages, webMode, url, file } = (await req.json()) as {
        messages: ChatMessage[];
        webMode: WebMode;
        url?: string | null;
        file?: { name: string; text: string } | null;
      };

  // history the model sees (drop our extra `sources` field)
  const history: ChatCompletionMessageParam[] = messages.map((m) => ({
    role: m.role,
    content:
      m.content.startsWith("![") && m.content.includes("(data:image")
        ? "[image]"
        : m.content,
  }));
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      try {

        // ---- chat-with-a-file path ----
        if (file && file.text) {
            send({ type: "status", status: "reading" });
            send({ type: "status", status: "writing" });
            const finalMessages: ChatCompletionMessageParam[] = [
              { role: "system", content: SYSTEM_PROMPT },
              ...history,
              {
                role: "system",
                content:
                  `The user attached a file named "${file.name}". Base your answer ONLY on its content below.\n\n` +
                  `${file.text}\n\n` +
                  `RULES:\n` +
                  `1. Answer only from the file content above; do not use outside knowledge or invent citations.\n` +
                  `2. Quote numbers, dates, and names exactly as they appear.\n` +
                  `3. If the file doesn't answer the question, say so clearly.`,
              },
            ];
            const answer = await createWithFallback({ model: MODEL, messages: finalMessages, stream: true });
            let full = "";
            for await (const chunk of answer) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) full += delta;
            }
            send({ type: "text", text: stripFakeCitations(full, 0) });
            send({ type: "done", usedWeb: false });
            controller.close();
            return;
          }
        // ---- chat-with-a-URL path: user attached a specific page ----
        if (url) {
          send({ type: "status", status: "searching", query: url });

          let fetched;
          try {
            fetched = await fetchUrlAsSource(url);
          } catch (err) {
            const msg = err instanceof FetchUrlError ? err.message : "Couldn't read that URL.";
            send({ type: "text", text: msg });
            send({ type: "done", usedWeb: false });
            controller.close();
            return;
          }

          const { source, text } = fetched;
          send({ type: "sources", sources: [source] });
          send({ type: "status", status: "reading" });
          send({ type: "status", status: "writing" });

          const finalMessages: ChatCompletionMessageParam[] = [
            { role: "system", content: SYSTEM_PROMPT },
            ...history,
            {
              role: "system",
              content:
                `The user attached one specific page. Base your answer ONLY on its content below.\n\n` +
                `[1] ${source.title} (${source.url})\n${text}\n\n` +
                `RULES:\n` +
                `1. Cite with [1] when referencing this page. Never invent other sources or write out URLs yourself.\n` +
                `2. State a number, date, or statistic ONLY if it literally appears above, quoted EXACTLY.\n` +
                `3. If the user's question isn't answered by this page, say so clearly — do not guess or use outside knowledge.\n` +
                `4. Use only the page content above, not your own memory.`,
            },
          ];

          const answer = await createWithFallback({
            model: MODEL,
            messages: finalMessages,
            stream: true,
          });
          let full = "";
          for await (const chunk of answer) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) full += delta;
          }
          send({ type: "text", text: stripFakeCitations(full, 1) });
          const followups = await generateFollowups(lastUser, full);
          if (followups.length > 0) send({ type: "followups", questions: followups });
          send({ type: "done", usedWeb: true });
          controller.close();
          return;
        }

        let searchQuery: string | null = null;

        // ---- decide whether to search, based on the mode ----
        if (webMode === "off") {
          searchQuery = null;
        } else if (webMode === "force") {
          searchQuery = lastUser;
        } else {
          // auto: let the model decide via tool calling (one non-streaming call)
          let decision;
          try {
            decision = await createWithFallback({
              model: MODEL,
              messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
              tools: [searchTool],
              tool_choice: "auto",
            });
          } catch {
            // model couldn't format a tool call — answer directly, no search
            const resp = await createWithFallback({
              model: MODEL,
              messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
            });
            const directText = stripFakeCitations(resp.choices[0]?.message?.content ?? "", 0);
            send({ type: "text", text: directText });
            const followups = await generateFollowups(lastUser, directText);
            if (followups.length > 0) send({ type: "followups", questions: followups });
            send({ type: "done", usedWeb: false });
            controller.close();
            return;
          }
          const msg = decision.choices[0].message;
          const call = msg.tool_calls?.[0];
          if (call) {
            try {
              searchQuery = JSON.parse(call.function.arguments).query || lastUser;
            } catch {
              searchQuery = lastUser;
            }
          } else {
            // model answered directly — no web, so no citations allowed
            const directText = stripFakeCitations(msg.content ?? "", 0);
            send({ type: "text", text: directText });
            const followups = await generateFollowups(lastUser, directText);
            if (followups.length > 0) send({ type: "followups", questions: followups });
            send({ type: "done", usedWeb: false });
            controller.close();
            return;
          }
        }

        // ---- no-search path (mode "off", or nothing to search) ----
        if (!searchQuery) {
          const resp = await createWithFallback({
            model: MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...history,
              {
                role: "system",
                content:
                  "You did NOT search the web for this reply and have NO sources. " +
                  "Do not include any citations, [n] markers, or URLs. Answer from " +
                  "general knowledge; if the user needs current or verifiable facts, " +
                  "suggest they switch Web mode on.",
              },
            ],
          });
          const text = stripFakeCitations(resp.choices[0]?.message?.content ?? "", 0);
          send({ type: "text", text });
          const followups = await generateFollowups(lastUser, text);
          if (followups.length > 0) send({ type: "followups", questions: followups });
          send({ type: "done", usedWeb: false });
          controller.close();
          return;
        }

        // ---- search + scrape path ----
        send({ type: "status", status: "searching", query: searchQuery });
        const sources: Source[] = await searchWeb(searchQuery);

        if (sources.length === 0) {
          send({ type: "text", text: "I couldn't find any web results for that." });
          send({ type: "done", usedWeb: false });
          controller.close();
          return;
        }

        // show the sites immediately, before the answer is written
        send({ type: "sources", sources });

        send({ type: "status", status: "reading" });
        const context = await readSources(searchQuery, sources);

        send({ type: "status", status: "writing" });

        // ---- credibility enforcement: tell the model how trustworthy each source is ----
        const credLines = sources
          .map((s) => {
            const c = (s as { credibility?: { label: string; score: number } }).credibility;
            return c ? `[${s.id}] ${s.domain} — ${c.label} credibility (${c.score}/100)` : `[${s.id}] ${s.domain}`;
          })
          .join("\n");
        const lowTrust = sources.filter(
          (s) => (s as { credibility?: { tier: string } }).credibility?.tier === "low"
        );

        const finalMessages: ChatCompletionMessageParam[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          {
            role: "system",
            content:
              `Web results are provided below. Base your answer ONLY on them.\n\n` +
              `${context}\n\n` +
              `SOURCE CREDIBILITY (assessed independently):\n${credLines}\n\n` +
              `RULES:\n` +
              `1. Cite sources ONLY with the markers [1], [2], ... matching the numbered sources above. NEVER write out a URL yourself and never invent a source.\n` +
              `2. State a number, date, or statistic ONLY if it literally appears in the sources, quoted EXACTLY — same digits and unit (if a source says "$300 million", never write "$3 billion"). Never round, scale, or convert.\n` +
              `3. If a fact is not in the sources, write "not stated in the sources".\n` +
              `4. If the sources above do NOT actually address the user's question, say clearly that the sources don't cover it — do NOT summarise unrelated material to fill space.\n` +
              `5. Use only the sources, not your own memory.\n` +
              `6. If sources disagree, say so and prefer the most authoritative one. Do not change your answer just because the user pushes back.\n` +
              `7. CREDIBILITY: Prefer High-credibility sources. When High and Low sources conflict, trust the High one. If a key claim rests ONLY on a Low-credibility source, you MUST flag it inline, e.g. "(source [4] is low-credibility)". Do not present a Low-credibility claim as established fact.`,
          },
        ];

        // Buffer the full answer, then strip any invented citations before
        // sending. We can only validate references once we see the whole text,
        // so for a data-checking bot we trade token-by-token streaming for
        // correctness on the web path.
        const answer = await createWithFallback({
          model: MODEL,
          messages: finalMessages,
          stream: true,
        });
        let full = "";
        for await (const chunk of answer) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) full += delta;
        }
        send({ type: "text", text: stripFakeCitations(full, sources.length) });

        const followups = await generateFollowups(lastUser, full);
        if (followups.length > 0) send({ type: "followups", questions: followups });

        send({ type: "done", usedWeb: true });
        controller.close();
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}