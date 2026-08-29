import { NextResponse } from "next/server";
import { z } from "zod";
import { createTicket, listTickets } from "@/lib/tickets";
import { runPipeline } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
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

  const ticket = await createTicket(parsed.data);

  // Fire-and-forget: the pipeline runs in the background of this long-lived Node
  // server. Not serverless-safe — a background job queue is an explicit non-goal
  // for the MVP. The UI (Phase 2) polls GET /api/tickets/:id for progress.
  void runPipeline(ticket.id).catch((err) => {
    console.error(`[pipeline] ticket ${ticket.id} crashed:`, err);
  });

  return NextResponse.json({ id: ticket.id, status: ticket.status }, { status: 201 });
}
