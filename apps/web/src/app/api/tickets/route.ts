import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createTicket, listTickets } from "@/lib/tickets";
import { runPipeline } from "@/lib/pipeline/run";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { getDefaultCustomerId, resolveProjectForTicket } from "@/lib/projects/resolve";
import { routeTicket } from "@/lib/pipeline/route";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  requester: z.string().trim().max(120).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  category: z.string().trim().max(80).optional(),
  approvals: z.array(z.string().max(60)).max(8).optional(),
  targetUsers: z.string().trim().max(200).optional(),
  targetScope: z.enum(["global", "scoped"]).optional(),
});

export async function GET() {
  return NextResponse.json({ tickets: await listTickets() });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { title, description, priority, category, approvals, targetUsers } = parsed.data;
  const targetScope = parsed.data.targetScope ?? "global";
  const requester = parsed.data.requester || user.name || user.email;

  // Fold the structured intake answers into the description so the BA sees them,
  // and persist the queryable ones on the ticket.
  const extras: string[] = [];
  if (requester) extras.push(`- Requester: ${requester}`);
  if (targetUsers) extras.push(`- Target users: ${targetUsers}`);
  if (approvals && approvals.length) extras.push(`- Approvals expected: ${approvals.join(", ")}`);
  if (priority) extras.push(`- Priority: ${priority}`);
  if (category) extras.push(`- Category: ${category}`);
  const fullDescription = extras.length
    ? `${description.trim()}\n\n## Intake details\n\n${extras.join("\n")}`
    : description;

  const customerId = await getDefaultCustomerId();

  // Route the work (NATIVE_ENGINE_BRIEF §6) — deterministic, at creation time.
  const [customer, scopedApps, defaultInstance] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, allowFluentFlows: true } }),
    prisma.fluentProject.findMany({ where: { customerId, kind: "scoped" }, select: { scope: true, name: true } }),
    prisma.instance.findFirst({ where: { customerId, env: "dev" } }),
  ]);
  const route = await routeTicket({
    requestText: `${title}\n\n${fullDescription}`,
    customer: customer ?? { id: customerId, allowFluentFlows: false },
    instance: defaultInstance,
    scopedApps,
  });

  // Only Fluent-tier tickets need a FluentProject + repo. A brand-new-app
  // request (FLUENT_SCOPED_APP) has no project yet — the ticket is created but
  // not run; an admin provisions the app first.
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
    description: `${fullDescription}\n\n## Routing\n\n- Tier: ${route.tier}${route.scope ? ` · scope: ${route.scope}` : ""}\n- ${route.rationale}`,
    requester: requester ?? null,
    priority: priority ?? null,
    category: category ?? null,
    targetScope,
    createdById: user.id,
    customerId,
    instanceId: project?.instanceId ?? defaultInstance?.id ?? null,
    projectId: project?.id ?? null,
    route,
  });

  // Fire-and-forget: the pipeline runs in the background of this long-lived Node
  // server. Not serverless-safe — a background job queue is an explicit non-goal
  // for the MVP. The UI (Phase 2) polls GET /api/tickets/:id for progress.
  // A FLUENT_SCOPED_APP ticket whose app isn't provisioned yet waits for an admin.
  if (!unprovisioned) {
    void runPipeline(ticket.id).catch((err) => {
      console.error(`[pipeline] ticket ${ticket.id} crashed:`, err);
    });
  }

  return NextResponse.json(
    { id: ticket.id, status: ticket.status, tier: route.tier, ...(unprovisioned ? { note: "new scoped app must be provisioned before this ticket can run" } : {}) },
    { status: 201 },
  );
}
