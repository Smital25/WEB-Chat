import type { Source } from "./types";
import { scoreSource } from "./credibility";

interface TavilyResult {
  title: string;
  url: string;
  content: string;        // Tavily's snippet
  raw_content?: string;   // fuller page content if include_raw_content is true
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Search the web with Tavily and return candidate sources (URLs + snippets).
 * Tavily is purpose-built for feeding LLMs; a free tier covers development.
 */
export async function searchWeb(query: string, maxResults = 4): Promise<Source[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set in .env.local");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: maxResults,
      search_depth: "basic",
      include_raw_content: true,
    }),
    // don't let a slow search hang the whole request
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { results?: TavilyResult[] };
  const results = data.results ?? [];

  return results.map((r, i) => {
    const domain = domainOf(r.url);
    return {
      id: i + 1,
      url: r.url,
      title: r.title || domain,
      domain,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      // keep a short snippet for the card; full text is added later by the scraper
      snippet: (r.content || "").slice(0, 200),
      credibility: scoreSource(r.url),
    } satisfies Source;
  });
}
