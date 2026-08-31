import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { getConversation } from "@/lib/intake/store";
import { extractReadyBlock } from "@/lib/intake/parse";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }

  const { id } = await params;
  const c = await getConversation(id, user.id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    conversation: {
      id: c.id,
      title: c.title,
      status: c.status,
      ticketId: c.ticketId,
      messages: c.messages.map((m) => ({
        id: m.id,
        role: m.role,
        // strip the machine block from anything we send to the client
        content: m.role === "assistant" ? extractReadyBlock(m.content).visible : m.content,
        ready: m.role === "assistant" ? extractReadyBlock(m.content).ready : null,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  });
}
