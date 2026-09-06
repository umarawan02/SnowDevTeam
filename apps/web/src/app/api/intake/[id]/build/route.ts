import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { getConversation } from "@/lib/intake/store";
import { extractReadyBlock, type IntakeReady } from "@/lib/intake/parse";
import { createTicket } from "@/lib/tickets";
import { runPipeline } from "@/lib/pipeline/run";
import { getDefaultCustomerId, resolveProjectForTicket } from "@/lib/projects/resolve";
import { routeTicket } from "@/lib/pipeline/route";

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

  const customerId = await getDefaultCustomerId();

  const [customer, scopedApps, defaultInstance] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, allowFluentFlows: true } }),
    prisma.fluentProject.findMany({ where: { customerId, kind: "scoped" }, select: { scope: true, name: true } }),
    prisma.instance.findFirst({ where: { customerId, env: "dev" } }),
  ]);
  const route = await routeTicket({
    requestText: description,
    customer: customer ?? { id: customerId, allowFluentFlows: false },
    instance: defaultInstance,
    scopedApps,
  });

  let project: { id: string; instanceId: string | null } | null = null;
  let unprovisioned = false;
  if (route.tier === "FLUENT_FLOW") {
    project = await resolveProjectForTicket({ customerId, kind: "global" });
  } else if (route.tier === "FLUENT_SCOPED_APP") {
    project = await resolveProjectForTicket({ customerId, kind: "scoped" }).catch(() => null);
    unprovisioned = !project;
  }

  const ticket = await createTicket({
    title,
    description: `${description}\n\n## Routing\n\n- Tier: ${route.tier}${route.scope ? ` · scope: ${route.scope}` : ""}\n- ${route.rationale}`,
    requester: user.name || user.email,
    priority: ready?.priority ?? null,
    category: ready?.category ?? null,
    targetScope,
    createdById: user.id,
    customerId,
    instanceId: project?.instanceId ?? defaultInstance?.id ?? null,
    projectId: project?.id ?? null,
    route,
  });

  await prisma.intakeConversation.update({
    where: { id },
    data: { status: "BUILDING", ticketId: ticket.id, ...(ready?.title ? { title: ready.title.slice(0, 120) } : {}) },
  });

  if (!unprovisioned) {
    void runPipeline(ticket.id).catch((err) => {
      console.error(`[pipeline] ticket ${ticket.id} crashed:`, err);
    });
  }

  return NextResponse.json({ ticketId: ticket.id, tier: route.tier }, { status: 201 });
}
