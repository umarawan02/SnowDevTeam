import { prisma } from "@/lib/db";
import { STEP_STATUS, TICKET_STATUS } from "@/lib/constants";

/**
 * The pipeline and the deploy run fire-and-forget inside the Node server
 * process — a restart (or a crash) kills them and leaves the ticket stuck in
 * RUNNING or DEPLOYING with nothing working on it. On server start, recover
 * those: a DEPLOYING ticket goes back to the review gate (re-deploy is
 * idempotent); a RUNNING ticket is marked FAILED so it can be resumed.
 *
 * A 5-minute floor guards against a second server instance racing a live run.
 */
const FLOOR_MS = 5 * 60 * 1000;

export async function recoverStaleTickets(): Promise<void> {
  const cutoff = new Date(Date.now() - FLOOR_MS);

  const deploying = await prisma.ticket.updateMany({
    where: { status: TICKET_STATUS.DEPLOYING, updatedAt: { lt: cutoff } },
    data: { status: TICKET_STATUS.READY_FOR_REVIEW },
  });

  const stuckRunning = await prisma.ticket.findMany({
    where: { status: TICKET_STATUS.RUNNING, updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const t of stuckRunning) {
    await prisma.agentStep.updateMany({
      where: { ticketId: t.id, status: STEP_STATUS.RUNNING },
      data: {
        status: STEP_STATUS.FAILED,
        error: "The pipeline stopped when the server restarted. Resume it, or send it back for rework.",
        completedAt: new Date(),
      },
    });
    await prisma.ticket.update({ where: { id: t.id }, data: { status: TICKET_STATUS.FAILED } });
  }

  if (deploying.count || stuckRunning.length) {
    console.log(
      `[recover] ${deploying.count} DEPLOYING → READY_FOR_REVIEW · ${stuckRunning.length} RUNNING → FAILED`,
    );
  }
}
