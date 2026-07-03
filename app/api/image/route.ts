import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt } = await req.json();
  if (!prompt || !String(prompt).trim()) {
    return NextResponse.json({ error: "A prompt is required." }, { status: 400 });
  }

  try {
    // Pollinations: free, no API key. Just fetch the URL and it returns an image.
    const url =
      `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}` +
      `?width=768&height=768&nologo=true&model=flux&key=${process.env.POLLINATIONS_KEY}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(55000) });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Image service returned ${res.status}. Try again in a moment.` },
        { status: res.status }
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return NextResponse.json({ image: `data:${contentType};base64,${base64}` });
  } catch (err) {
    return NextResponse.json(
      { error: `Image generation error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}