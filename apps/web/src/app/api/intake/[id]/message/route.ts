import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { getConversation } from "@/lib/intake/store";
import { streamIntakeReply, type ChatMessage } from "@/lib/intake/assistant";
import { extractReadyBlock } from "@/lib/intake/parse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ content: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }

  const { id } = await params;
  const convo = await getConversation(id, user.id);
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (convo.status !== "GATHERING") {
    return NextResponse.json({ error: "this conversation has already started development" }, { status: 409 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "message required" }, { status: 400 });

  await prisma.intakeMessage.create({
    data: { conversationId: id, role: "user", content: parsed.data.content },
  });

  const history: ChatMessage[] = [
    ...convo.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: parsed.data.content },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        const reply = streamIntakeReply(history);
        for await (const event of reply) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            full += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        console.error("[intake] stream error:", err);
        const note = "\n\n_(the assistant hit an error — please try again)_";
        full += note;
        controller.enqueue(encoder.encode(note));
      }

      try {
        await prisma.intakeMessage.create({
          data: { conversationId: id, role: "assistant", content: full },
        });
        const { ready } = extractReadyBlock(full);
        await prisma.intakeConversation.update({
          where: { id },
          data: {
            updatedAt: new Date(),
            ...(ready?.title ? { title: ready.title.slice(0, 120) } : {}),
          },
        });
      } catch (err) {
        console.error("[intake] persist error:", err);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
