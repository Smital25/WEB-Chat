import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/chats/:id — load messages for one chat (only if it's yours)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const chat = await prisma.chat.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = chat.messages.map((m: { role: string; content: string; sources: string | null }) => ({
    role: m.role,
    content: m.content,
    sources: m.sources ? JSON.parse(m.sources) : undefined,
  }));
  return NextResponse.json({ chat: { id: chat.id, title: chat.title }, messages });
}

// POST /api/chats/:id — append one message; set title from first user message
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const owned = await prisma.chat.findFirst({ where: { id, userId } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { role, content, sources } = await req.json();
  await prisma.message.create({
    data: { chatId: id, role, content, sources: sources ? JSON.stringify(sources) : null },
  });

  if (role === "user" && owned.title === "New chat") {
    await prisma.chat.update({ where: { id }, data: { title: String(content).slice(0, 60) } });
  } else {
    await prisma.chat.update({ where: { id }, data: { updatedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}

// PATCH /api/chats/:id — rename a chat
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
    const { id } = await params;
    const owned = await prisma.chat.findFirst({ where: { id, userId } });
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  
    const { title } = await req.json();
    if (!title || !String(title).trim()) {
      return NextResponse.json({ error: "Title required" }, { status: 400 });
    }
    await prisma.chat.update({ where: { id }, data: { title: String(title).slice(0, 80) } });
    return NextResponse.json({ ok: true });
  }
  
  // DELETE /api/chats/:id — delete a chat (and its messages via cascade)
  export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
    const { id } = await params;
    const owned = await prisma.chat.findFirst({ where: { id, userId } });
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  
    await prisma.chat.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }