import { llm, MODEL, SYSTEM_PROMPT } from "@/lib/llm";
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

export async function POST(req: Request) {
  const { messages, webMode } = (await req.json()) as {
    messages: ChatMessage[];
    webMode: WebMode;
  };

  // history the model sees (drop our extra `sources` field)
  const history: ChatCompletionMessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      try {
        let searchQuery: string | null = null;

        // ---- decide whether to search, based on the mode ----
        if (webMode === "off") {
          searchQuery = null;
        } else if (webMode === "force") {
          searchQuery = lastUser;
        } else {
          // auto: let the model decide via tool calling (one non-streaming call)
// auto: let the model decide via tool calling (one non-streaming call)
        let decision;
        try {
        decision = await llm.chat.completions.create({
            model: MODEL,
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
            tools: [searchTool],
            tool_choice: "auto",
        });
        } catch {
        // model couldn't format a tool call — answer directly, no search
        const resp = await llm.chat.completions.create({
            model: MODEL,
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        });
        send({ type: "text", text: stripFakeCitations(resp.choices[0]?.message?.content ?? "", 0) });
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
            send({ type: "text", text: stripFakeCitations(msg.content ?? "", 0) });
            send({ type: "done", usedWeb: false });
            controller.close();
            return;
          }
        }

        // ---- no-search path (mode "off", or nothing to search) ----
        if (!searchQuery) {
          const resp = await llm.chat.completions.create({
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
        const finalMessages: ChatCompletionMessageParam[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          {
            role: "system",
            content:
              `Web results are provided below. Base your answer ONLY on them.\n\n` +
              `${context}\n\n` +
              `RULES:\n` +
              `1. Cite sources ONLY with the markers [1], [2], ... matching the numbered sources above. NEVER write out a URL yourself and never invent a source.\n` +
              `2. State a number, date, or statistic ONLY if it literally appears in the sources, quoted EXACTLY — same digits and unit (if a source says "$300 million", never write "$3 billion"). Never round, scale, or convert.\n` +
              `3. If a fact is not in the sources, write "not stated in the sources".\n` +
              `4. If the sources above do NOT actually address the user's question, say clearly that the sources don't cover it — do NOT summarise unrelated material to fill space.\n` +
              `5. Use only the sources, not your own memory.\n` +
              `6. If sources disagree, say so and prefer the most authoritative one. Do not change your answer just because the user pushes back.`,
          },
        ];

        // Buffer the full answer, then strip any invented citations before
        // sending. We can only validate references once we see the whole text,
        // so for a data-checking bot we trade token-by-token streaming for
        // correctness on the web path.
        const answer = await llm.chat.completions.create({
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