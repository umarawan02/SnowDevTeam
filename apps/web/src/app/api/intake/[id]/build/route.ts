import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { getConversation } from "@/lib/intake/store";
import { extractReadyBlock, type IntakeReady } from "@/lib/intake/parse";
import { createTicket } from "@/lib/tickets";
import { runPipeline } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // Idempotent — a second click just returns the ticket already started.
  if (convo.status === "BUILDING" && convo.ticketId) {
    return NextResponse.json({ ticketId: convo.ticketId });
  }
  if (convo.messages.filter((m) => m.role === "user").length === 0) {
    return NextResponse.json({ error: "nothing to build yet — describe your request first" }, { status: 400 });
  }

  // Latest ready block wins; otherwise synthesize from the transcript.
  let ready: IntakeReady | null = null;
  for (const m of convo.messages) {
    if (m.role === "assistant") {
      const r = extractReadyBlock(m.content).ready;
      if (r) ready = r;
    }
  }
  const firstUser = convo.messages.find((m) => m.role === "user")?.content ?? "";
  const title = (ready?.title || firstUser.split(/[.\n]/)[0].trim() || "Feature request").slice(0, 200);

  const transcript = convo.messages
    .map((m) => `**${m.role === "user" ? "Requester" : "Assistant"}:** ${extractReadyBlock(m.content).visible || m.content}`)
    .join("\n\n");

  const detailLines: string[] = [];
  if (ready?.priority) detailLines.push(`- Priority: ${ready.priority}`);
  if (ready?.category) detailLines.push(`- Category: ${ready.category}`);
  if (ready?.approvals?.length) detailLines.push(`- Approvals expected: ${ready.approvals.join(", ")}`);
  if (ready?.targetUsers) detailLines.push(`- Requestable by: ${ready.targetUsers}`);
  const targetScope = ready?.targetScope === "scoped" ? "scoped" : "global";
  detailLines.push(
    `- Target scope: ${targetScope === "scoped" ? "scoped app (x_1460392_delivery)" : "global"}`,
  );
  detailLines.push(`- Submitted by: ${user.name || user.email}`);

  const description = [
    ready?.description || firstUser,
    "",
    "## Intake details",
    "",
    detailLines.join("\n"),
    "",
    "## Conversation",
    "",
    transcript,
  ].join("\n");

  const ticket = await createTicket({
    title,
    description,
    requester: user.name || user.email,
    priority: ready?.priority ?? null,
    category: ready?.category ?? null,
    targetScope,
    createdById: user.id,
  });

  await prisma.intakeConversation.update({
    where: { id },
    data: { status: "BUILDING", ticketId: ticket.id, ...(ready?.title ? { title: ready.title.slice(0, 120) } : {}) },
  });

  void runPipeline(ticket.id).catch((err) => {
    console.error(`[pipeline] ticket ${ticket.id} crashed:`, err);
  });

  return NextResponse.json({ ticketId: ticket.id }, { status: 201 });
}
