import { NextResponse } from "next/server";
import { z } from "zod";
import { createTicket, listTickets } from "@/lib/tickets";
import { runPipeline } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  requester: z.string().trim().max(120).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  category: z.string().trim().max(80).optional(),
  approvals: z.array(z.string().max(60)).max(8).optional(),
  targetUsers: z.string().trim().max(200).optional(),
});

export async function GET() {
  return NextResponse.json({ tickets: await listTickets() });
}

export async function POST(req: Request) {
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

  const { title, description, requester, priority, category, approvals, targetUsers } = parsed.data;

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

  const ticket = await createTicket({
    title,
    description: fullDescription,
    requester: requester ?? null,
    priority: priority ?? null,
    category: category ?? null,
  });

  // Fire-and-forget: the pipeline runs in the background of this long-lived Node
  // server. Not serverless-safe — a background job queue is an explicit non-goal
  // for the MVP. The UI (Phase 2) polls GET /api/tickets/:id for progress.
  void runPipeline(ticket.id).catch((err) => {
    console.error(`[pipeline] ticket ${ticket.id} crashed:`, err);
  });

  return NextResponse.json({ id: ticket.id, status: ticket.status }, { status: 201 });
}
