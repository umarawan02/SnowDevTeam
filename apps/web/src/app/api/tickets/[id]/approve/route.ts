import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TICKET_STATUS } from "@/lib/constants";
import { deployTicket } from "@/lib/pipeline/deploy";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  void deployTicket(id).catch((err) => {
    console.error(`[deploy] ticket ${id} crashed:`, err);
  });

  return NextResponse.json({ status: TICKET_STATUS.DEPLOYING }, { status: 202 });
}
