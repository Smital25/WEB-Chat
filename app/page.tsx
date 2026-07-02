"use client";

import { useEffect, useRef, useState } from "react";
import {
  Globe,
  Sparkles,
  Ban,
  ArrowUp,
  Square,
  Search,
  BookOpen,
  PencilLine,
  ExternalLink,
  Check,
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Copy,
  RotateCcw,
  Download,
  Link2,
  X,
  Paperclip,
  FileText,
} from "lucide-react";
import type { ChatMessage, Source, StreamEvent, WebMode } from "@/lib/types";
import { signOut } from "next-auth/react";

const EXAMPLES = [
  "What's the latest in AI this week?",
  "Explain how RAG works",
  "Summarise the newest GPT model's benchmarks",
  "Who won the last F1 race?",
];

const MODES: { id: WebMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "auto", label: "Auto", icon: <Sparkles size={13} />, hint: "Search only when needed" },
  { id: "force", label: "Web", icon: <Globe size={13} />, hint: "Always search the web" },
  { id: "off", label: "Off", icon: <Ban size={13} />, hint: "Never search" },
];

type Phase = "idle" | "searching" | "reading" | "writing";
const PHASE_ORDER: Phase[] = ["searching", "reading", "writing"];
const STAGES = [
  { key: "searching", label: "Search", icon: Search },
  { key: "reading", label: "Read", icon: BookOpen },
  { key: "writing", label: "Answer", icon: PencilLine },
];

interface ChatSummary {
  id: string;
  title: string;
}

function getCred(s: Source) {
  return (s as unknown as {
    credibility?: { tier: "high" | "medium" | "low"; label: string; score: number; reasons: string[] };
  }).credibility;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<WebMode>("auto");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const [hoverCite, setHoverCite] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // ── chat-with-a-URL state ──
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [attachedUrl, setAttachedUrl] = useState<string | null>(null);

  // ── chat-with-a-file state ──
  const [attachedFile, setAttachedFile] = useState<{ name: string; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── chat history state ──
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase, statusText]);

  useEffect(() => {
    loadChats();
  }, []);

  async function loadChats() {
    try {
      const res = await fetch("/api/chats");
      if (res.ok) {
        const data = await res.json();
        setChats(data.chats ?? []);
      }
    } catch {
      /* ignore */
    }
  }

  function newChat() {
    setActiveChatId(null);
    setMessages([]);
    setInput("");
    setAttachedUrl(null);
    setAttachedFile(null);
  }

  async function renameChat(id: string, current: string) {
    const title = window.prompt("Rename chat", current);
    if (!title || !title.trim()) return;
    await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    loadChats();
  }

  async function deleteChat(id: string) {
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (activeChatId === id) {
      setActiveChatId(null);
      setMessages([]);
    }
    loadChats();
  }

  async function openChat(id: string) {
    setActiveChatId(id);
    try {
      const res = await fetch(`/api/chats/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
      }
    } catch {
      /* ignore */
    }
  }

  async function saveMessage(chatId: string, role: string, content: string, sources?: Source[]) {
    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content, sources }),
      });
    } catch {
      /* ignore */
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Couldn't read that file.");
      } else {
        setAttachedFile({ name: data.name, text: data.text });
      }
    } catch {
      alert("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function send(text: string, opts?: { replaceLast?: boolean }) {
    const urlForThisTurn = opts?.replaceLast ? null : attachedUrl;
    const fileForThisTurn = opts?.replaceLast ? null : attachedFile;
    const q =
      text.trim() ||
      (urlForThisTurn ? "Summarize this page and highlight the key points." : "") ||
      (fileForThisTurn ? "Summarize this file and highlight the key points." : "");
    if (!q || busy) return;
    if (!opts?.replaceLast) {
      setAttachedUrl(null);
      setAttachedFile(null);
    }

    // make sure this conversation has a chat row to save into
    let chatId = activeChatId;
    if (!chatId) {
      try {
        const r = await fetch("/api/chats", { method: "POST" });
        if (r.ok) {
          const d = await r.json();
          chatId = d.chat.id as string;
          setActiveChatId(chatId);
        }
      } catch {
        /* ignore — chat still works, just won't persist */
      }
    }

    const base = opts?.replaceLast ? messages.slice(0, -1) : messages;
    const nextHistory: ChatMessage[] = opts?.replaceLast ? base : [...base, { role: "user", content: q }];

    setMessages([...nextHistory, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setPhase("idle");
    setStatusText("Thinking…");

    if (chatId && !opts?.replaceLast) saveMessage(chatId, "user", q);

    const controller = new AbortController();
    abortRef.current = controller;

    let finalContent = "";
    let finalSources: Source[] | undefined;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory,
          webMode: mode,
          url: urlForThisTurn,
          file: fileForThisTurn,
        }),
        signal: controller.signal,
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as StreamEvent;
          if (evt.type === "text") finalContent += evt.text;
          if (evt.type === "sources") finalSources = evt.sources;
          handleEvent(evt);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        patchLast((m) => ({ ...m, content: m.content || "_(stopped)_" }));
      } else {
        patchLast((m) => ({ ...m, content: m.content || `Something went wrong: ${(err as Error).message}` }));
      }
    } finally {
      setBusy(false);
      setPhase("idle");
      setStatusText("");
      abortRef.current = null;
    }

    if (chatId && finalContent) {
      await saveMessage(chatId, "assistant", finalContent, finalSources);
      loadChats();
    }
  }

  function regenerate() {
    if (busy) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    send(lastUser.content, { replaceLast: true });
  }

  async function copyMessage(content: string, idx: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      /* ignore */
    }
  }

  function exportChatAsMarkdown() {
    if (messages.length === 0) return;
    let md = `# Chat export\n\n`;
    for (const m of messages) {
      if (m.role === "user") {
        md += `### You\n\n${m.content}\n\n`;
      } else {
        md += `### Assistant\n\n${m.content}\n\n`;
        if (m.sources && m.sources.length > 0) {
          md += `**Sources**\n\n`;
          for (const s of m.sources) {
            md += `${s.id}. [${s.title}](${s.url}) — ${s.domain}\n`;
          }
          md += `\n`;
        }
      }
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chat-export.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleEvent(evt: StreamEvent) {
    switch (evt.type) {
      case "status":
        if (evt.status === "searching") {
          setPhase("searching");
          setStatusText(`Searching${evt.query ? ` — “${evt.query}”` : ""}`);
        } else if (evt.status === "reading") {
          setPhase("reading");
          setStatusText("Reading the sources");
        } else if (evt.status === "writing") {
          setPhase("writing");
          setStatusText("Composing the answer");
        }
        break;
      case "sources":
        patchLast((m) => ({ ...m, sources: evt.sources }));
        break;
      case "followups":
        patchLast((m) => ({ ...m, followups: evt.questions }));
        break;
      case "text":
        patchLast((m) => ({ ...m, content: m.content + evt.text }));
        break;
      case "error":
        patchLast((m) => ({ ...m, content: `⚠️ ${evt.message}` }));
        break;
      case "done":
        break;
    }
  }

  function patchLast(fn: (m: ChatMessage) => ChatMessage) {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });
  }

  const empty = messages.length === 0;
  const activeMode = MODES.find((x) => x.id === mode)!;
  const modeIndex = MODES.findIndex((x) => x.id === mode);

  const placeholder = attachedFile
    ? "Ask about this file…"
    : attachedUrl
    ? "Ask something about this page…"
    : "Ask anything…";

  return (
    <div className="ec-root relative flex h-screen text-stone-900">
      <StyleBlock />

      {/* ── sidebar ── */}
      <aside className="ec-glass hidden w-64 shrink-0 flex-col border-r border-stone-200/70 sm:flex">
        <div className="flex items-center gap-2 border-b border-stone-200/70 px-4 py-3">
          <span className="ec-mark grid h-7 w-7 place-items-center rounded-lg text-white">
            <Globe size={14} />
          </span>
          <span className="font-serif text-sm font-semibold">The Web Reader</span>
        </div>
        <div className="p-3">
          <button
            onClick={newChat}
            className="ec-mark flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            <Plus size={15} /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-xs text-stone-400">No chats yet.</p>
          ) : (
            chats.map((c) => (
              <div
                key={c.id}
                className={`group mb-1 flex items-center gap-1 rounded-lg pr-1 text-sm transition-colors ${
                  activeChatId === c.id ? "bg-amber-100 text-stone-900" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                <button
                  onClick={() => openChat(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
                >
                  <MessageSquare size={13} className="shrink-0 opacity-60" />
                  <span className="truncate">{c.title}</span>
                </button>
                <button
                  onClick={() => renameChat(c.id, c.title)}
                  title="Rename"
                  className="shrink-0 rounded p-1 text-stone-400 opacity-0 transition hover:bg-white hover:text-stone-700 group-hover:opacity-100"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => deleteChat(c.id)}
                  title="Delete"
                  className="shrink-0 rounded p-1 text-stone-400 opacity-0 transition hover:bg-white hover:text-rose-600 group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="ec-glass sticky top-0 z-20 border-b border-stone-200/70 px-5 py-3">
          <div className="mx-auto flex max-w-3xl items-center gap-2.5">
            <span className="ec-mark grid h-8 w-8 place-items-center rounded-lg text-white sm:hidden">
              <Globe size={16} />
            </span>
            <h1 className="font-serif text-[19px] font-semibold tracking-tight sm:hidden">
              The Web <span className="ec-accent-text">Reader</span>
            </h1>
            {!empty && (
              <button
                onClick={exportChatAsMarkdown}
                title="Export chat as Markdown"
                className="ml-2 flex items-center gap-1 text-xs text-stone-500 transition-colors hover:text-stone-900"
              >
                <Download size={13} /> Export
              </button>
            )}
            <span className="ml-auto hidden text-[11px] uppercase tracking-[0.18em] text-stone-400 sm:block">
              reads · verifies · cites
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/signin" })}
              className="ml-auto text-xs text-stone-500 transition-colors hover:text-stone-900 sm:ml-4"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5">
          <div className="mx-auto max-w-3xl py-8">
            {empty ? (
              <EmptyState onPick={send} />
            ) : (
              <div className="space-y-8">
                {messages.map((m, i) => {
                  const isLast = i === messages.length - 1;
                  return (
                    <div key={i} className="ec-rise">
                      <MessageBubble
                        m={m}
                        idx={i}
                        isLastAssistant={isLast && m.role === "assistant" && !busy}
                        hoverCite={hoverCite}
                        setHoverCite={setHoverCite}
                        onCopy={copyMessage}
                        copied={copiedIdx === i}
                        onRegenerate={regenerate}
                        onFollowup={send}
                      />
                      {isLast && busy && <Pipeline phase={phase} statusText={statusText} onStop={stop} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* composer */}
        <div className="ec-glass border-t border-stone-200/70 px-5 py-3">
          <div className="mx-auto max-w-3xl">
            {attachedUrl && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                <Link2 size={12} className="shrink-0" />
                <span className="truncate">{attachedUrl}</span>
                <button
                  onClick={() => setAttachedUrl(null)}
                  className="ml-auto shrink-0 rounded p-0.5 hover:bg-amber-100"
                  aria-label="Remove attached URL"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {attachedFile && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                <FileText size={12} className="shrink-0" />
                <span className="truncate">{attachedFile.name}</span>
                <button
                  onClick={() => setAttachedFile(null)}
                  className="ml-auto shrink-0 rounded p-0.5 hover:bg-amber-100"
                  aria-label="Remove file"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {uploading && <div className="mb-2 text-xs text-stone-400">Reading file…</div>}
            {showUrlInput && (
              <div className="mb-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const trimmed = urlDraft.trim();
                      if (trimmed) {
                        setAttachedUrl(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
                      }
                      setUrlDraft("");
                      setShowUrlInput(false);
                    } else if (e.key === "Escape") {
                      setUrlDraft("");
                      setShowUrlInput(false);
                    }
                  }}
                  placeholder="Paste a URL and press Enter…"
                  className="ec-input flex-1 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-[13px] outline-none placeholder:text-stone-400"
                />
                <button
                  onClick={() => {
                    setUrlDraft("");
                    setShowUrlInput(false);
                  }}
                  className="rounded p-1 text-stone-400 hover:text-stone-700"
                  aria-label="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="ec-input flex items-end gap-2 rounded-2xl border border-stone-300 bg-white px-3 py-2">
              <button
                onClick={() => setShowUrlInput((v) => !v)}
                title="Chat with a URL"
                aria-label="Attach a URL"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${
                  attachedUrl ? "bg-amber-100 text-amber-700" : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                }`}
              >
                <Link2 size={16} />
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Attach a file (PDF, Word, text)"
                aria-label="Attach a file"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${
                  attachedFile ? "bg-amber-100 text-amber-700" : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                }`}
              >
                <Paperclip size={16} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,text/*"
                onChange={handleFile}
                className="hidden"
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder={placeholder}
                className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-stone-400"
              />
              <button
                onClick={() => (busy ? stop() : send(input))}
                disabled={!busy && !input.trim() && !attachedUrl && !attachedFile}
                aria-label={busy ? "Stop" : "Send"}
                className={`ec-send grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition disabled:opacity-30 ${
                  busy ? "bg-stone-900" : "ec-mark"
                }`}
              >
                {busy ? <Square size={14} fill="currentColor" /> : <ArrowUp size={17} />}
              </button>
            </div>

            {/* mode toggle with a sliding indicator */}
            <div className="mt-2.5 flex items-center gap-3">
              <div className="ec-seg relative flex rounded-full bg-stone-100 p-0.5">
                <span
                  className="ec-seg-pill absolute top-0.5 bottom-0.5 rounded-full"
                  style={{ left: `calc(${modeIndex} * (100% / 3) + 2px)`, width: "calc(100% / 3 - 4px)" }}
                />
                {MODES.map((mo) => (
                  <button
                    key={mo.id}
                    onClick={() => setMode(mo.id)}
                    title={mo.hint}
                    className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      mode === mo.id ? "text-white" : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    {mo.icon}
                    {mo.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-stone-400">{activeMode.hint}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── pipeline rail ───────────── */

function Pipeline({ phase, statusText, onStop }: { phase: Phase; statusText: string; onStop: () => void }) {
  const current = PHASE_ORDER.indexOf(phase);
  const showRail = current >= 0;

  return (
    <div className="ec-rise ec-glass mt-4 rounded-2xl border border-stone-200 bg-white/70 p-4">
      {showRail ? (
        <div className="flex items-center">
          {STAGES.map((s, i) => {
            const done = i < current;
            const active = i === current;
            const Icon = s.icon;
            return (
              <div key={s.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`grid h-8 w-8 place-items-center rounded-full border transition-all ${
                      done
                        ? "ec-mark border-transparent text-white"
                        : active
                        ? "ec-stage-active border-amber-500 text-amber-700"
                        : "border-stone-200 bg-white text-stone-300"
                    }`}
                  >
                    {done ? <Check size={15} /> : <Icon size={15} />}
                  </div>
                  <span className={`text-[11px] font-medium ${active ? "text-amber-700" : done ? "text-stone-700" : "text-stone-300"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className="mx-1 h-[2px] flex-1 overflow-hidden rounded bg-stone-200">
                    <div className={`h-full ec-mark transition-all duration-500 ${i < current ? "w-full" : "w-0"}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <Sparkles size={15} className="ec-spin-slow text-amber-600" />
          <span>{statusText || "Thinking…"}</span>
        </div>
      )}

      {showRail && (
        <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
          <span className="flex items-center gap-1.5 text-xs text-stone-500">
            <span className="ec-dot h-1.5 w-1.5 rounded-full bg-amber-500" />
            {statusText}
          </span>
          <button onClick={onStop} className="text-xs text-stone-400 hover:text-stone-700">
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────── messages ───────────── */

function MessageBubble({
  m,
  idx,
  isLastAssistant,
  hoverCite,
  setHoverCite,
  onCopy,
  copied,
  onRegenerate,
  onFollowup,
}: {
  m: ChatMessage;
  idx: number;
  isLastAssistant: boolean;
  hoverCite: number | null;
  setHoverCite: (n: number | null) => void;
  onCopy: (content: string, idx: number) => void;
  copied: boolean;
  onRegenerate: () => void;
  onFollowup: (text: string) => void;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 text-[15px] text-stone-50">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {m.content && (
        <div className="ec-fade max-w-[95%] border-l-2 border-amber-200 pl-4 font-serif text-[16px] leading-[1.7] text-stone-800">
          {renderWithCitations(m.content, m.sources, hoverCite, setHoverCite)}
        </div>
      )}
      {m.content && (
        <div className="flex items-center gap-3 pl-4 text-xs text-stone-400">
          <button
            onClick={() => onCopy(m.content, idx)}
            className="flex items-center gap-1 transition-colors hover:text-stone-700"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {isLastAssistant && (
            <button onClick={onRegenerate} className="flex items-center gap-1 transition-colors hover:text-stone-700">
              <RotateCcw size={12} /> Regenerate
            </button>
          )}
        </div>
      )}
      {m.sources && m.sources.length > 0 && (
        <SourceList sources={m.sources} hoverCite={hoverCite} setHoverCite={setHoverCite} />
      )}
      {isLastAssistant && m.followups && m.followups.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-4">
          {m.followups.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowup(q)}
              className="ec-followup rounded-full border border-stone-200 bg-white/70 px-3 py-1.5 text-xs text-stone-600 transition-colors hover:border-amber-400 hover:text-stone-900"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceList({
  sources,
  hoverCite,
  setHoverCite,
}: {
  sources: Source[];
  hoverCite: number | null;
  setHoverCite: (n: number | null) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
        <span className="h-px w-6 bg-stone-300" />
        {sources.length} source{sources.length > 1 ? "s" : ""} read
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {sources.map((s, idx) => {
          const cred = getCred(s);
          const lit = hoverCite === s.id;
          return (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              onMouseEnter={() => setHoverCite(s.id)}
              onMouseLeave={() => setHoverCite(null)}
              style={{ animationDelay: `${idx * 70}ms` }}
              className={`ec-card ec-glass group relative flex gap-3 rounded-xl border bg-white/80 p-3 transition-all ${
                lit ? "border-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" : "border-stone-200 hover:border-stone-400"
              }`}
            >
              <span className="ec-mark mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white">
                {s.id}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-stone-500">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.favicon} alt="" className="h-3.5 w-3.5 rounded-sm" />
                  <span className="truncate">{s.domain}</span>
                  <ExternalLink size={11} className="opacity-0 transition group-hover:opacity-100" />
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-stone-900">{s.title}</span>
                  {cred && <CredBadge cred={cred} />}
                </div>
                {cred && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-stone-100">
                    <div
                      className={`h-full rounded-full ${
                        cred.tier === "high" ? "bg-emerald-500" : cred.tier === "medium" ? "bg-amber-500" : "bg-rose-500"
                      }`}
                      style={{ width: `${cred.score}%` }}
                    />
                  </div>
                )}
                <div className="mt-1.5 line-clamp-2 text-xs text-stone-500">{s.snippet}</div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function CredBadge({ cred }: { cred: { tier: "high" | "medium" | "low"; label: string; score: number; reasons: string[] } }) {
  const styles = {
    high: "bg-emerald-50 text-emerald-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-rose-50 text-rose-700",
  }[cred.tier];
  const dot = { high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-rose-500" }[cred.tier];
  return (
    <span
      title={`${cred.label} credibility (${cred.score}/100) — ${cred.reasons.join(", ")}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${styles}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {cred.label}
    </span>
  );
}

function renderWithCitations(
  content: string,
  sources: Source[] | undefined,
  hoverCite: number | null,
  setHoverCite: (n: number | null) => void
) {
  if (!sources || sources.length === 0) return <span className="whitespace-pre-wrap">{content}</span>;
  const byId = new Map(sources.map((s) => [s.id, s]));
  const parts = content.split(/(\[\d+\])/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const id = Number(match[1]);
          const src = byId.get(id);
          if (src) {
            return (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                onMouseEnter={() => setHoverCite(id)}
                onMouseLeave={() => setHoverCite(null)}
                className={`ec-cite mx-0.5 rounded px-1 align-baseline text-[11px] font-semibold no-underline transition-colors ${
                  hoverCite === id ? "bg-amber-400 text-white" : "bg-amber-100 text-amber-800"
                }`}
              >
                {match[1]}
              </a>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

/* ───────────── empty state ───────────── */

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="pt-20 text-center">
      <h2 className="ec-rise font-serif text-4xl font-semibold leading-tight text-stone-900">
        Ask, and it <span className="ec-accent-text">reads the web</span>
        <br /> to answer you.
      </h2>
      <p className="ec-rise mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-stone-500" style={{ animationDelay: "80ms" }}>
        It searches, reads full pages, weighs each source, and answers with citations you can trace.
      </p>
      <div className="mx-auto mt-8 grid max-w-lg gap-2.5 sm:grid-cols-2">
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex}
            onClick={() => onPick(ex)}
            style={{ animationDelay: `${120 + i * 60}ms` }}
            className="ec-rise ec-card ec-glass rounded-xl border border-stone-200 bg-white/70 px-4 py-3 text-left font-serif text-[15px] text-stone-700 transition-colors hover:border-amber-400"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────── styles ───────────── */

function StyleBlock() {
  return (
    <style>{`
      .ec-root { background:
        radial-gradient(60% 40% at 15% 0%, rgba(251,191,36,0.10), transparent 60%),
        radial-gradient(50% 40% at 90% 5%, rgba(244,114,60,0.08), transparent 60%),
        #faf9f7; }
      .ec-glass { background: rgba(255,255,255,0.65); backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%); }
      .ec-mark { background-image: linear-gradient(135deg,#f59e0b,#d97706,#b45309); }
      .ec-accent-text { background-image: linear-gradient(120deg,#d97706,#b45309); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .ec-seg-pill { background-image: linear-gradient(135deg,#f59e0b,#b45309); transition: left .28s cubic-bezier(.22,1,.36,1), width .28s cubic-bezier(.22,1,.36,1); }
      .ec-input { box-shadow: 0 1px 2px rgba(0,0,0,.04); transition: box-shadow .2s, border-color .2s; }
      .ec-input:focus-within { border-color:#d97706; box-shadow: 0 0 0 4px rgba(217,119,6,.12); }
      .ec-send:hover { transform: scale(1.06); }
      .ec-send:active { transform: scale(.9); }
      .ec-card { animation: ecCard .45s cubic-bezier(.22,1,.36,1) both; }
      .ec-card:hover { transform: translateY(-3px); }
      .ec-rise { animation: ecRise .5s cubic-bezier(.22,1,.36,1) both; }
      .ec-fade { animation: ecFade .5s ease both; }
      @keyframes ecRise { from { opacity:0; transform: translateY(14px);} to { opacity:1; transform:none;} }
      @keyframes ecCard { from { opacity:0; transform: translateY(10px) scale(.98);} to { opacity:1; transform:none;} }
      @keyframes ecFade { from { opacity:0;} to { opacity:1;} }
      .ec-stage-active { background:#fffbeb; box-shadow: 0 0 0 4px rgba(245,158,11,.16); animation: ecPulse 1.4s ease-in-out infinite; }
      @keyframes ecPulse { 0%,100%{ box-shadow:0 0 0 4px rgba(245,158,11,.16);} 50%{ box-shadow:0 0 0 7px rgba(245,158,11,.05);} }
      .ec-dot { animation: ecBlink 1s steps(1) infinite; }
      @keyframes ecBlink { 0%,100%{opacity:1;} 50%{opacity:.25;} }
      .ec-spin-slow { animation: ecSpin 2.4s linear infinite; }
      @keyframes ecSpin { to { transform: rotate(360deg);} }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition-duration:.01ms !important; } }
    `}</style>
  );
}