import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TICKET_STATUS } from "@/lib/constants";
import { deployTicket } from "@/lib/pipeline/deploy";
import { requireUser, AuthError } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ticket.status !== TICKET_STATUS.READY_FOR_REVIEW) {
    return NextResponse.json(
      { error: `ticket is ${ticket.status}; only a READY_FOR_REVIEW ticket can be approved` },
      { status: 409 },
    );
  }

  // Build + deploy runs for minutes — fire-and-forget, the UI polls for progress.
  // deployTicket re-checks the READY_FOR_REVIEW guard itself.
  void deployTicket(id, user.id).catch((err) => {
    console.error(`[deploy] ticket ${id} crashed:`, err);
  });

  return NextResponse.json({ status: TICKET_STATUS.DEPLOYING }, { status: 202 });
}
