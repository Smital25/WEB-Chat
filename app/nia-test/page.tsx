"use client";
import { useState } from "react";

export default function NiaTest() {
  const [query, setQuery] = useState("latest AI news");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setResult("");
    try {
      const res = await fetch("/api/nia-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setResult("Error: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <h2>Nia Search Test</h2>
      <input value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 300, padding: 6 }} />
      <button onClick={run} disabled={loading} style={{ marginLeft: 8, padding: "6px 12px" }}>
        {loading ? "Searching…" : "Search"}
      </button>
      <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", background: "#f4f4f4", padding: 12 }}>{result}</pre>
    </div>
  );
}