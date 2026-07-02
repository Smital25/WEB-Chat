# Web Chat — a chatbot that reads the web

A conversational chatbot built entirely in **Next.js (App Router + TypeScript)**.
It chats normally, and when a question needs fresh facts it **searches the web,
scrapes the pages, answers with inline citations, and shows you every source it used**.

Web access has three modes: **Auto** (the model decides), **Web** (always search),
and **Off** (never search).

---

## 1. What's inside

```
web-chat/
├─ app/
│  ├─ page.tsx            # the whole chat UI (client component)
│  ├─ layout.tsx
│  ├─ globals.css
│  └─ api/chat/route.ts   # the backend: decide → search → scrape → answer (streamed)
├─ lib/
│  ├─ llm.ts              # OpenAI-compatible LLM client (OpenAI / DeepSeek / Ollama)
│  ├─ search.ts           # web search via Tavily
│  ├─ scrape.ts           # page scraping via cheerio (+ graceful fallback)
│  └─ types.ts            # shared types
└─ .env.local.example
```

There is **no separate backend server** — Next.js Route Handlers are the backend.

## 2. Setup

**Prerequisites:** Node.js 18.18+ (or 20+).

```bash
# 1. install
npm install

# 2. add your keys
cp .env.local.example .env.local
#   then edit .env.local (see below)

# 3. run
npm run dev
#   open http://localhost:3000
```

### Keys you need (both have free options)

| Variable | What | Where |
|---|---|---|
| `TAVILY_API_KEY` | Web search | Free 1,000 searches/mo at https://app.tavily.com |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | The chat model | See below |

**LLM options (pick one):**

- **OpenAI:** `LLM_BASE_URL=https://api.openai.com/v1`, `LLM_MODEL=gpt-4o-mini`
- **DeepSeek (cheap):** `LLM_BASE_URL=https://api.deepseek.com`, `LLM_MODEL=deepseek-chat`
- **Ollama (free, local, no key needed):** install [Ollama](https://ollama.com), run `ollama pull llama3.1`, then
  `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=llama3.1`, `LLM_API_KEY=ollama`

## 3. How it works (the loop)

1. You send a message. The API decides whether to search:
   - **Auto** → the model is offered a `search_web` tool and decides for itself.
   - **Web** → always search (query = your message).
   - **Off** → never search; answer from the model's own knowledge.
2. If searching: **Tavily** finds candidate sites → **cheerio** scrapes each page's
   main text → the source cards appear in the UI immediately.
3. The scraped text is handed to the LLM, which writes an answer citing `[1] [2]`
   that link to the matching source cards.
4. Everything streams back live (search status → sources → answer tokens) over a
   simple newline-delimited JSON stream.

## 4. Ideas to enhance it (roadmap)

Easy:
- Persist chat history (localStorage or a database).
- "Quick vs Deep" toggle (change `max_results` in `lib/search.ts`).
- Skip searching on greetings even in **Web** mode.

Trust features (great for a report / demo):
- **Credibility badge** per source (domain age, HTTPS, is-primary-source, recency).
- **"Sources agree / disagree"** indicator when two pages conflict.
- **Confidence level** on the answer.

Heavier:
- Swap `lib/scrape.ts` for **Firecrawl** (managed, handles JavaScript & anti-bot) or
  **Playwright** (render JS pages) — nothing else changes.
- Add a **vector database** (Qdrant/Chroma) to remember and re-use past sources.
- Let the user **paste a URL** and chat with that specific page.

## 5. Notes & gotchas

- Some sites block scraping or need JavaScript; the app falls back to the search
  snippet so answers still work. Use Firecrawl/Playwright for tougher sites.
- `maxDuration` in `route.ts` is 60s. On Vercel's free tier serverless functions are
  short-lived; for long research runs, self-host or use a paid plan.
- **Auto mode will occasionally guess wrong** (search when it shouldn't, or skip when it
  should). That's expected — the manual **Web/Off** toggle is the override.
