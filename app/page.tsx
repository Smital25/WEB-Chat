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
  Mic, MicOff,
  Image as ImageIcon,
  ShieldCheck,
  FileSearch,

} from "lucide-react";
import type { ChatMessage, Source, StreamEvent, WebMode } from "@/lib/types";
import { signOut, useSession } from "next-auth/react";

const EXAMPLES = [
  "What's the latest in AI this week?",
  "Explain how RAG works",
  "Summarise the newest GPT model's benchmarks",
  "Who won the last F1 race?",
];

const MODES: { id: WebMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "auto", label: "Auto", icon: <Sparkles size={13} />, hint: "Search only when needed" },
  { id: "force", label: "Web", icon: <Globe size={13} />, hint: "Always search the web" },
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
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? "";
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

  // ── voice recognition state ──
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // ── image generation state ──
  const [imageMode, setImageMode] = useState(false);

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

  function toggleVoice() {
    // browser support check
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }

    // if already listening, stop
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalText = "";
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      setInput((finalText + interim).trim());
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
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

  async function generateImage(prompt: string) {
    const q = prompt.trim();
    if (!q || busy) return;
    let chatId = activeChatId;
    if (!chatId) {
      try {
        const r = await fetch("/api/chats", { method: "POST" });
        if (r.ok) { const d = await r.json(); chatId = d.chat.id as string; setActiveChatId(chatId); }
      } catch { /* ignore */ }
    }
    const nextHistory: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages([...nextHistory, { role: "assistant", content: "🎨 Generating image…" }]);
    setInput("");
    setBusy(true);
    if (chatId) saveMessage(chatId, "user", q);
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        patchLast((m) => ({ ...m, content: `⚠️ ${data.error}` }));
      } else {
        patchLast((m) => ({ ...m, content: `![${q}](${data.image})` }));
        if (chatId) saveMessage(chatId, "assistant", `![${q}](${data.image})`);
        loadChats();
      }
    } catch (err) {
      patchLast((m) => ({ ...m, content: `⚠️ ${(err as Error).message}` }));
    } finally {
      setBusy(false);
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
  const [selectedSourceIdx, setSelectedSourceIdx] = useState<number | null>(null);
  const latestSourceIdx = messages.map((m, i) => (m.role === "assistant" && m.sources && m.sources.length ? i : -1)).filter((i) => i >= 0).pop() ?? null;
  const panelIdx = selectedSourceIdx !== null && messages[selectedSourceIdx]?.sources?.length ? selectedSourceIdx : latestSourceIdx;
  const activeSources = panelIdx !== null ? messages[panelIdx]?.sources : undefined;
  const activeMode = MODES.find((x) => x.id === mode)!;
  const modeIndex = MODES.findIndex((x) => x.id === mode);

  const placeholder = imageMode
    ? "Describe an image to generate…"
    : attachedFile
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
        <div className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">Recent</div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-xs text-stone-400">No chats yet.</p>
          ) : (
            chats.map((c) => (
              <div
                key={c.id}
                className={`group mb-1 flex items-center gap-1 rounded-lg pr-1 text-sm transition-colors ${
                  activeChatId === c.id ? "bg-orange-100 text-stone-900" : "text-stone-600 hover:bg-stone-100"
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
                  className="shrink-0 rounded-md p-1.5 text-stone-400 transition hover:bg-white hover:text-indigo-600"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => deleteChat(c.id)}
                  title="Delete"
                  className="shrink-0 rounded-md p-1.5 text-stone-400 transition hover:bg-white hover:text-rose-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
        {/* profile area */}
        <div className="border-t border-stone-200/70 p-3">
          <div className="mb-2 px-1 text-[11px] font-medium text-stone-400">Welcome back</div>
          <div className="flex items-center gap-2.5 rounded-xl border border-stone-200/70 bg-white/70 p-2.5">
            <div className="ec-mark grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white">
              {(userEmail || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-stone-800">{userEmail || "Signed in"}</div>
              <button onClick={() => signOut({ callbackUrl: "/signin" })} className="text-[11px] text-stone-400 transition-colors hover:text-rose-600">
                Sign out
              </button>
            </div>
          </div>
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
            <span className="hidden text-[11px] uppercase tracking-[0.18em] text-stone-400 sm:block">
              reads · verifies · cites
            </span>
            {!empty && (
              <button
                onClick={exportChatAsMarkdown}
                title="Export chat as Markdown"
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-indigo-300 hover:text-stone-900"
              >
                <Download size={13} /> Export
              </button>
            )}
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
                    <div
                      key={i}
                      className={`ec-rise ${m.role === "assistant" && m.sources && m.sources.length ? "cursor-pointer" : ""}`}
                      onClick={() => { if (m.role === "assistant" && m.sources && m.sources.length) setSelectedSourceIdx(i); }}
                    >
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
                      {isLast && busy && <div className="lg:hidden"><Pipeline phase={phase} statusText={statusText} onStop={stop} /></div>}
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
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs text-orange-800">
                <Link2 size={12} className="shrink-0" />
                <span className="truncate">{attachedUrl}</span>
                <button
                  onClick={() => setAttachedUrl(null)}
                  className="ml-auto shrink-0 rounded p-0.5 hover:bg-orange-100"
                  aria-label="Remove attached URL"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {attachedFile && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs text-orange-800">
                <FileText size={12} className="shrink-0" />
                <span className="truncate">{attachedFile.name}</span>
                <button
                  onClick={() => setAttachedFile(null)}
                  className="ml-auto shrink-0 rounded p-0.5 hover:bg-orange-100"
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
                  attachedUrl ? "bg-orange-100 text-orange-700" : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                }`}
              >
                <Link2 size={16} />
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Attach a file (PDF, Word, text)"
                aria-label="Attach a file"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${
                  attachedFile ? "bg-orange-100 text-orange-700" : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                }`}
              >
                <Paperclip size={16} />
              </button>
              <button
                onClick={toggleVoice}
                title={listening ? "Stop listening" : "Speak your question"}
                aria-label="Voice input"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${
                  listening
                    ? "bg-rose-100 text-rose-600 ec-pulse-mic"
                    : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                }`}
              >
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <button
                onClick={() => setImageMode((v) => !v)}
                title="Image mode — generate a picture"
                aria-label="Image mode"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${
                  imageMode
                    ? "bg-orange-100 text-orange-700"
                    : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                }`}
              >
                <ImageIcon size={16} />
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
                    imageMode ? generateImage(input) : send(input);
                  }
                }}
                rows={1}
                placeholder={placeholder}
                className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-stone-400"
              />
              <button
                onClick={() => (busy ? stop() : imageMode ? generateImage(input) : (send(input)))}
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
                  style={{ left: `calc(${modeIndex} * (100% / 2) + 2px)`, width: "calc(100% / 2 - 4px)" }}
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

      {/* ── research / sources panel (right) ── */}
      <aside className="ec-glass hidden w-96 shrink-0 flex-col border-l border-stone-200/70 lg:flex">
        <div className="flex items-center gap-2 border-b border-stone-200/70 px-5 py-[13px]">
          <Search size={14} className="text-indigo-500" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Research &amp; Sources</span>
        </div>
        {activeSources && activeSources.length > 0 && !busy && (
          <div className="grid grid-cols-2 gap-2 border-b border-stone-200/70 px-4 py-3">
            <div className="ec-glass rounded-xl border border-stone-200/70 p-3">
              <div className="text-lg font-semibold text-stone-900">{activeSources.length}</div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400">Sources read</div>
            </div>
            <div className="ec-glass rounded-xl border border-stone-200/70 p-3">
              <div className="text-lg font-semibold text-stone-900">{Math.round(activeSources.reduce((a, x) => a + (getCred(x)?.score ?? 0), 0) / activeSources.length)}<span className="text-xs text-stone-400">/100</span></div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400">Avg credibility</div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">
          {busy ? (
            <Pipeline phase={phase} statusText={statusText} onStop={stop} />
          ) : activeSources && activeSources.length > 0 ? (
            <SourceList sources={activeSources} hoverCite={hoverCite} setHoverCite={setHoverCite} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-stone-400">
              <div className="ec-glass mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-stone-200/70">
                <BookOpen size={22} className="opacity-50" />
              </div>
              <p className="text-sm font-medium text-stone-500">Sources appear here</p>
              <p className="mt-1 text-xs">As I search and read the web, the sites I use and their credibility scores will show up in this panel.</p>
            </div>
          )}
        </div>
      </aside>
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
                        ? "ec-stage-active border-orange-500 text-orange-700"
                        : "border-stone-200 bg-white text-stone-300"
                    }`}
                  >
                    {done ? <Check size={15} /> : <Icon size={15} />}
                  </div>
                  <span className={`text-[11px] font-medium ${active ? "text-orange-700" : done ? "text-stone-700" : "text-stone-300"}`}>
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
          <Sparkles size={15} className="ec-spin-slow text-orange-600" />
          <span>{statusText || "Thinking…"}</span>
        </div>
      )}

      {showRail && (
        <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
          <span className="flex items-center gap-1.5 text-xs text-stone-500">
            <span className="ec-dot h-1.5 w-1.5 rounded-full bg-orange-500" />
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
        m.content.startsWith("![") && m.content.includes("(data:image") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.content.match(/\((data:image[^)]+)\)/)?.[1] || ""}
            alt="Generated image"
            className="ec-fade max-w-full rounded-xl border border-stone-200 shadow-sm"
          />
        ) : (
          <div className="ec-fade max-w-[95%] border-l-2 border-orange-200 pl-4 font-serif text-[16px] leading-[1.7] text-stone-800">
            {renderWithCitations(m.content, m.sources, hoverCite, setHoverCite)}
          </div>
        )
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
        <div className="lg:hidden">
          <SourceList sources={m.sources} hoverCite={hoverCite} setHoverCite={setHoverCite} />
        </div>
      )}
      {isLastAssistant && m.followups && m.followups.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-4">
          {m.followups.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowup(q)}
              className="ec-followup rounded-full border border-stone-200 bg-white/70 px-3 py-1.5 text-xs text-stone-600 transition-colors hover:border-orange-400 hover:text-stone-900"
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
                lit ? "border-orange-400 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" : "border-stone-200 hover:border-stone-400"
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
                        cred.tier === "high" ? "bg-emerald-500" : cred.tier === "medium" ? "bg-orange-500" : "bg-rose-500"
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
    medium: "bg-orange-50 text-orange-700",
    low: "bg-rose-50 text-rose-700",
  }[cred.tier];
  const dot = { high: "bg-emerald-500", medium: "bg-orange-500", low: "bg-rose-500" }[cred.tier];
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
                  hoverCite === id ? "bg-orange-400 text-white" : "bg-orange-100 text-orange-800"
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

const FEATURES = [
  { icon: Globe, title: "Reads the web", desc: "Searches and reads full pages, not just snippets." },
  { icon: ShieldCheck, title: "Scores credibility", desc: "Weighs every source and flags low-trust ones." },
  { icon: BookOpen, title: "Traceable citations", desc: "Every claim links back to a real source." },
  { icon: FileSearch, title: "Files, URLs & voice", desc: "Ask about a PDF, a page, or just speak." },
];

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="pt-16">
      <div className="text-center">
        <h2 className="ec-rise font-serif text-4xl font-semibold leading-tight text-stone-900">
          Ask, and it <span className="ec-accent-text">reads the web</span>
          <br /> to answer you.
        </h2>
        <p className="ec-rise mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-stone-500" style={{ animationDelay: "80ms" }}>
          It searches, reads full pages, weighs each source, and answers with citations you can trace.
        </p>
      </div>

      {/* premium feature cards */}
      <div className="mx-auto mt-10 grid max-w-2xl gap-3 sm:grid-cols-2">
        {FEATURES.map((f, i) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              style={{ animationDelay: `${120 + i * 70}ms` }}
              className="ec-rise ec-card ec-glass flex items-start gap-3 rounded-2xl border border-stone-200 bg-white/70 p-4 text-left"
            >
              <span className="ec-mark grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white">
                <Icon size={17} />
              </span>
              <div>
                <div className="text-sm font-semibold text-stone-900">{f.title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-stone-500">{f.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* example prompts */}
      <div className="mx-auto mt-8 max-w-2xl">
        <div className="mb-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Try asking</div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {EXAMPLES.map((ex, i) => (
            <button
              key={ex}
              onClick={() => onPick(ex)}
              style={{ animationDelay: `${380 + i * 60}ms` }}
              className="ec-rise ec-card ec-glass rounded-xl border border-stone-200 bg-white/70 px-4 py-3 text-left font-serif text-[15px] text-stone-700 transition-colors hover:border-indigo-400"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── styles ───────────── */
function StyleBlock() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&display=swap');

      :root {
        --bg: #fafafb;
        --surface: #ffffff;
        --ink: #14151a;
        --muted: #6b7280;
        --border: #ececf1;
        --border-strong: #dfe0e7;
        --primary: #4f46e5;
        --primary-2: #6366f1;
        --accent: #8b5cf6;
        --radius: 14px;
        --shadow-xs: 0 1px 2px rgba(20,21,26,.04);
        --shadow-sm: 0 2px 6px rgba(20,21,26,.05), 0 1px 2px rgba(20,21,26,.04);
        --shadow-md: 0 6px 20px rgba(20,21,26,.07), 0 2px 6px rgba(20,21,26,.04);
        --shadow-lg: 0 16px 44px rgba(20,21,26,.10);
      }

      .ec-root {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: var(--ink);
        letter-spacing: -0.012em;
        background:
          radial-gradient(50% 40% at 0% 0%, rgba(99,102,241,0.05), transparent 60%),
          radial-gradient(45% 35% at 100% 0%, rgba(139,92,246,0.045), transparent 60%),
          var(--bg);
      }
      /* refined headings — bold, tight, modern (not serif) */
      .font-serif { font-family: 'Inter', sans-serif !important; font-weight: 700; letter-spacing: -0.03em; }

      /* brand accents */
      .ec-mark { background-image: linear-gradient(135deg,#6366f1,#4f46e5); box-shadow: 0 2px 8px rgba(79,70,229,.25); }
      .ec-accent-text { background-image: linear-gradient(120deg,#4f46e5,#7c3aed); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .ec-seg-pill { background:#fff; box-shadow: var(--shadow-sm); border: 1px solid var(--border); transition: left .28s cubic-bezier(.22,1,.36,1), width .28s cubic-bezier(.22,1,.36,1); }

      /* glass surfaces */
      .ec-glass { background: rgba(255,255,255,0.78); backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%); }

      /* composer — the focal point, make it feel crafted */
      .ec-input { background:#fff; border:1px solid var(--border-strong) !important; border-radius: var(--radius); box-shadow: var(--shadow-md); transition: box-shadow .2s, border-color .2s, transform .2s; }
      .ec-input:focus-within { border-color: var(--primary) !important; box-shadow: 0 0 0 4px rgba(79,70,229,.12), var(--shadow-md); }
      .ec-send { box-shadow: 0 3px 10px rgba(79,70,229,.3); }
      .ec-send:hover { transform: translateY(-1px) scale(1.05); }
      .ec-send:active { transform: scale(.92); }

      /* cards — crisp borders, layered depth, satisfying hover */
      .ec-card { animation: ecCard .5s cubic-bezier(.22,1,.36,1) both; border:1px solid var(--border) !important; border-radius: var(--radius) !important; box-shadow: var(--shadow-xs); background:#fff; }
      .ec-card:hover { transform: translateY(-3px); border-color: var(--border-strong) !important; box-shadow: var(--shadow-lg); }
      .ec-rise { animation: ecRise .55s cubic-bezier(.22,1,.36,1) both; }
      .ec-fade { animation: ecFade .5s ease both; }
      @keyframes ecRise { from { opacity:0; transform: translateY(16px);} to { opacity:1; transform:none;} }
      @keyframes ecCard { from { opacity:0; transform: translateY(10px) scale(.985);} to { opacity:1; transform:none;} }
      @keyframes ecFade { from { opacity:0;} to { opacity:1;} }

      /* thinking / status */
      .ec-stage-active { background:#eef2ff; box-shadow: 0 0 0 4px rgba(99,102,241,.16); animation: ecPulse 1.4s ease-in-out infinite; }
      .ec-pulse-mic { animation: ecPulse 1.2s ease-in-out infinite; }
      @keyframes ecPulse { 0%,100%{ box-shadow:0 0 0 4px rgba(99,102,241,.16);} 50%{ box-shadow:0 0 0 8px rgba(99,102,241,.04);} }
      .ec-dot { animation: ecBlink 1s steps(1) infinite; }
      @keyframes ecBlink { 0%,100%{opacity:1;} 50%{opacity:.25;} }
      .ec-spin-slow { animation: ecSpin 2.4s linear infinite; }
      @keyframes ecSpin { to { transform: rotate(360deg);} }

      /* refined scrollbars */
      * { scrollbar-width: thin; scrollbar-color: #d5d7e0 transparent; }
      *::-webkit-scrollbar { width: 8px; height: 8px; }
      *::-webkit-scrollbar-thumb { background:#d5d7e0; border-radius:8px; }
      *::-webkit-scrollbar-thumb:hover { background:#c2c5d2; }

      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition-duration:.01ms !important; } }
    `}</style>
  );
}