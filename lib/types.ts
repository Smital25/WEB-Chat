// Shared types used by both the API and the UI.
import type { Credibility } from "./credibility";
export type WebMode = "auto" | "force" | "off";

export type ChatRole = "user" | "assistant";

export interface Source {
  id: number;        // 1-based, matches the [n] citations in the answer
  url: string;
  title: string;
  domain: string;    // e.g. "en.wikipedia.org"
  favicon: string;   // favicon image URL
  snippet: string;   // short preview shown on the card
  credibility: Credibility;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  sources?: Source[]; // only present on assistant messages that used the web
}

// Streamed events the API sends back (one JSON object per line, NDJSON).
export type StreamEvent =
  | { type: "status"; status: "searching" | "reading" | "writing" | "done"; query?: string }
  | { type: "sources"; sources: Source[] }
  | { type: "text"; text: string }
  | { type: "done"; usedWeb: boolean }
  | { type: "error"; message: string };
