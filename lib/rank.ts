// BM25 passage ranking. Splits scraped pages into passages, scores each
// against the user's query with the Okapi BM25 algorithm, and returns only
// the top passages. This means the model reads the sentences that actually
// answer the question, instead of a wall of text where facts get mangled.

const K1 = 1.5; // term-frequency saturation (standard BM25 default)
const B = 0.75; // length-normalisation strength (standard BM25 default)

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$%.\s-]/g, " ") // keep digits, $, %, . for numeric facts
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// Break a page into passages of ~2-3 sentences each.
function splitPassages(text: string, targetWords = 60): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const passages: string[] = [];
  let buf: string[] = [];
  let count = 0;
  for (const s of sentences) {
    buf.push(s);
    count += s.split(/\s+/).length;
    if (count >= targetWords) {
      passages.push(buf.join(" "));
      buf = [];
      count = 0;
    }
  }
  if (buf.length) passages.push(buf.join(" "));
  return passages.filter((p) => p.trim().length > 40);
}

export interface RankedPassage {
  text: string;
  sourceId: number;
  score: number;
}

/**
 * Rank all passages from all sources against the query with BM25.
 * @returns the top `topK` passages, highest score first.
 */
export function rankPassages(
  query: string,
  docs: { sourceId: number; text: string }[],
  topK = 6
): RankedPassage[] {
  // 1) build the passage corpus
  const passages: { text: string; sourceId: number; tokens: string[] }[] = [];
  for (const d of docs) {
    for (const p of splitPassages(d.text)) {
      passages.push({ text: p, sourceId: d.sourceId, tokens: tokenize(p) });
    }
  }
  if (passages.length === 0) return [];

  const N = passages.length;
  const avgLen = passages.reduce((s, p) => s + p.tokens.length, 0) / N;

  // 2) document frequency for each query term
  const qTerms = Array.from(new Set(tokenize(query)));
  const df = new Map<string, number>();
  for (const term of qTerms) {
    let n = 0;
    for (const p of passages) if (p.tokens.includes(term)) n++;
    df.set(term, n);
  }

  // 3) BM25 score per passage
  const scored: RankedPassage[] = passages.map((p) => {
    let score = 0;
    const len = p.tokens.length;
    for (const term of qTerms) {
      const n = df.get(term) ?? 0;
      if (n === 0) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5)); // BM25 idf
      const tf = p.tokens.filter((t) => t === term).length;
      const denom = tf + K1 * (1 - B + (B * len) / avgLen);
      score += idf * ((tf * (K1 + 1)) / denom);
    }
    return { text: p.text, sourceId: p.sourceId, score };
  });

  // 4) return the best passages overall
  return scored
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}