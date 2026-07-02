import * as cheerio from "cheerio";
import type { Source } from "./types";
import { rankPassages } from "./rank";

const UA =
  "Mozilla/5.0 (compatible; WebChatBot/1.0; +https://example.com/bot)";

/**
 * Fetch a page and extract its readable main text (the actual "scraping").
 * Works on static / server-rendered pages. For heavy JavaScript sites,
 * swap this for Firecrawl or Playwright — nothing else needs to change.
 */
export async function scrapePage(url: string, maxChars = 6000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside, noscript, iframe, form").remove();

  const raw = $("article").text() || $("main").text() || $("body").text() || "";
  return raw.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/**
 * Scrape each source, then use BM25 to select only the passages most relevant
 * to the query. The model receives the best sentences (with credibility tags),
 * not a wall of text — so facts and numbers come through far more reliably.
 */
export async function readSources(query: string, sources: Source[]): Promise<string> {
  // 1) scrape full text for each source (fall back to snippet on failure)
  const docs = await Promise.all(
    sources.map(async (s) => {
      let text = s.snippet;
      try {
        const scraped = await scrapePage(s.url);
        if (scraped && scraped.length > 200) text = scraped;
      } catch {
        // keep the snippet
      }
      return { sourceId: s.id, text };
    })
  );

  // 2) rank all passages across all sources with BM25
  const top = rankPassages(query, docs, 6);

  // 3) if ranking found nothing (e.g. very short query), fall back to snippets
  if (top.length === 0) {
    return sources
      .map((s) => `[${s.id}] ${s.title}\n${s.snippet}`)
      .join("\n\n---\n\n");
  }

  // 4) format the top passages, grouped with their source number
  return top
    .map((p) => `[${p.sourceId}]\n${p.text}`)
    .join("\n\n---\n\n");

  // // 4) format the top passages, grouped with their source number + credibility
  // return top
  //   .map((p) => {
  //     const cred = credById.get(p.sourceId);
  //     const tag = cred ? ` — Credibility: ${cred.label}` : "";
  //     return `[${p.sourceId}]${tag}\n${p.text}`;
  //   })
  //   .join("\n\n---\n\n");
}