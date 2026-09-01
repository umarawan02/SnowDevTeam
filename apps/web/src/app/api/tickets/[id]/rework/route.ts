import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { TICKET_STATUS } from "@/lib/constants";
import { runRework } from "@/lib/pipeline/run";
import { parseReworkFrom } from "@/lib/pipeline/parse";
import { requireUser, AuthError } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

const Body = z.object({
  fromRole: z.enum(["ARCHITECT", "SENIOR_DEV", "DEVELOPER"]).optional(),
  note: z.string().trim().min(1, "a note is required").max(4000),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser(["ADMIN", "REVIEWER"]);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
    }
    throw e;
  }

  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return NextResponse.json({ error: "not found" }, { status: 404 });

  const hasDeployLog = ticket.artifacts.some((a) => a.type === "DEPLOY_LOG");
  const reworkable =
    ticket.status === TICKET_STATUS.READY_FOR_REVIEW ||
    (ticket.status === TICKET_STATUS.FAILED && hasDeployLog);
  if (!reworkable) {
    return NextResponse.json(
      { error: `ticket is ${ticket.status}; only a ready-for-review ticket or a build failure can be sent back for rework` },
      { status: 409 },
    );
  }

  // Default the rework stage to QA's own recommendation.
  const qaText =
    [...ticket.artifacts].reverse().find((a) => a.type === "QA_REPORT")?.content ?? "";
  const fromRole = parsed.data.fromRole ?? parseReworkFrom(qaText) ?? "DEVELOPER";

  void runRework(id, { fromRole, note: parsed.data.note, reviewerId: user.id }).catch((err) => {
    console.error(`[rework] ticket ${id} crashed:`, err);
  });

  return NextResponse.json({ status: TICKET_STATUS.RUNNING, fromRole }, { status: 202 });
}
