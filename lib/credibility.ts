export type CredibilityTier = "high" | "medium" | "low";

export interface Credibility {
  score: number;
  tier: CredibilityTier;
  label: string;
  reasons: string[];
}

const HIGH_TRUST = [
  "wikipedia.org", "britannica.com", "nature.com", "science.org", "arxiv.org",
  "ieee.org", "acm.org", "springer.com", "nytimes.com", "bbc.com", "bbc.co.uk",
  "reuters.com", "apnews.com", "theguardian.com", "bloomberg.com", "wsj.com",
  "economist.com", "espn.com", "who.int", "nih.gov", "nasa.gov",
];
const LOW_TRUST = [
  "reddit.com", "quora.com", "medium.com", "substack.com", "pinterest.com",
  "facebook.com", "x.com", "twitter.com", "tiktok.com", "blogspot.com",
  "wordpress.com", "answers.com", "ehow.com",
];

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}
function endsWithAny(host: string, list: string[]): boolean {
  return list.some((d) => host === d || host.endsWith("." + d));
}

export function scoreSource(url: string): Credibility {
  const host = domainOf(url);
  let score = 55;
  const reasons: string[] = [];

  if (/\.gov(\.|$)/.test(host) || /\.mil(\.|$)/.test(host)) {
    score += 30; reasons.push("Government domain");
  } else if (/\.edu(\.|$)/.test(host) || /\.ac\.[a-z]{2}$/.test(host)) {
    score += 25; reasons.push("Academic domain");
  } else if (host.endsWith(".org")) {
    score += 8; reasons.push("Non-profit (.org) domain");
  }
  if (endsWithAny(host, HIGH_TRUST)) { score += 25; reasons.push("Well-established source"); }
  if (endsWithAny(host, LOW_TRUST)) { score -= 30; reasons.push("User-generated / forum content"); }
  if (url.startsWith("http://")) { score -= 8; reasons.push("Not served over HTTPS"); }

  score = Math.max(5, Math.min(100, score));
  const tier: CredibilityTier = score >= 75 ? "high" : score >= 45 ? "medium" : "low";
  const label = tier === "high" ? "High" : tier === "medium" ? "Medium" : "Low";
  if (reasons.length === 0) reasons.push("General website");
  return { score, tier, label, reasons };
}