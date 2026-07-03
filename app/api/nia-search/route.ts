import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = process.env.NIA_API_KEY;
  if (!key) return NextResponse.json({ error: "NIA_API_KEY not set in .env.local" }, { status: 500 });

  const { query } = await req.json();
  if (!query || !String(query).trim()) {
    return NextResponse.json({ error: "A query is required." }, { status: 400 });
  }

  try {
    const res = await fetch("https://apigcp.trynia.ai/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "web",          // web search via Nia; try "deep" for research
        query: String(query),
        num_results: 5,
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (!res.ok) {
      const msg = await res.text();
      return NextResponse.json({ error: `Nia search failed (${res.status}): ${msg.slice(0, 200)}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ result: data });
  } catch (err) {
    return NextResponse.json({ error: `Nia error: ${(err as Error).message}` }, { status: 500 });
  }
}