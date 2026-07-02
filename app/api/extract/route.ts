import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 400 });
  }

  const name = file.name;
  const lower = name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let text = "";

    if (lower.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text: pdfText } = await extractText(pdf, { mergePages: true });
      text = Array.isArray(pdfText) ? pdfText.join("\n") : pdfText;
    } else if (lower.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".csv") ||
      file.type.startsWith("text/")
    ) {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Use PDF, Word (.docx), or a text file." },
        { status: 400 }
      );
    }

    text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    if (text.length < 20) {
      return NextResponse.json(
        { error: "Couldn't extract readable text (a scanned PDF has no selectable text)." },
        { status: 422 }
      );
    }

    return NextResponse.json({ name, text: text.slice(0, 16000) });
  } catch (err) {
    return NextResponse.json(
      { error: `Couldn't read that file: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}