import path from "node:path";
import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE, TICKET_STATUS } from "@/lib/constants";
import { validatePlan } from "@/lib/nativeengine/plan";
import { applyChangePlan } from "@/lib/nativeengine/apply";
import { nativeTicketDir } from "@/lib/nativeengine/scripts";
import { runAtfForPlan } from "@/lib/nativeengine/qa";
import { ticketDirName } from "@/lib/pipeline/parse";
import type { DeployResult } from "@/lib/pipeline/deploy";

/**
 * Deploy path for a native-tier ticket (`executionTier` starting `NATIVE_`):
 * the reviewer-approved `CHANGE_PLAN` artifact is applied via the Table-API +
 * update-set engine instead of the Fluent build/install. Called only by
 * `deployTicket` after the `READY_FOR_REVIEW` + human-Approve guard.
 */
export async function deployNativeTicket(ticketId: string, reviewerId?: string | null): Promise<DeployResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { artifacts: true, instance: true, customer: true },
  });
  if (!ticket) return { ok: false, ticketId, status: "?", error: "ticket not found" };
  if (!ticket.instance) return { ok: false, ticketId, status: ticket.status, error: "ticket has no Instance assigned" };
  if (!ticket.customer) return { ok: false, ticketId, status: ticket.status, error: "ticket has no Customer assigned" };

  const planArtifact = ticket.artifacts.find((a) => a.type === ARTIFACT_TYPE.CHANGE_PLAN);
  if (!planArtifact) {
    return { ok: false, ticketId, status: ticket.status, error: "native ticket has no CHANGE_PLAN artifact" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(planArtifact.content);
  } catch (e) {
    return { ok: false, ticketId, status: ticket.status, error: `CHANGE_PLAN artifact is not valid JSON: ${String(e)}` };
  }
  const validation = validatePlan(parsed);
  if (!validation.ok || !validation.plan) {
    return { ok: false, ticketId, status: ticket.status, error: `CHANGE_PLAN failed validation: ${validation.errors.join("; ")}` };
  }

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: TICKET_STATUS.DEPLOYING, ...(reviewerId ? { reviewedById: reviewerId } : {}) },
  });

  const ticketDir = ticket.gitBranch?.replace(/^ticket\//, "") || ticketDirName(ticketId, ticket.title);
  const scriptsDir = path.join(nativeTicketDir(ticket.customer.slug, ticketDir));

  const result = await applyChangePlan({
    ticketId,
    instance: ticket.instance,
    plan: validation.plan,
    scriptsDir,
    actorId: reviewerId,
  });

  if (!result.ok) {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
    return { ok: false, ticketId, status: TICKET_STATUS.FAILED, error: result.error };
  }

  // ATF (brief §5.5) — the plan's tests ship in the same update set; run them now.
  const atf = await runAtfForPlan({ ticketId, instance: ticket.instance, plan: validation.plan });
  if (atf.ran && !atf.passed) {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
    return { ok: false, ticketId, status: TICKET_STATUS.FAILED, error: `applied, but ATF failed: ${atf.summary}` };
  }

  await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.DEPLOYED } });
  return { ok: true, ticketId, status: TICKET_STATUS.DEPLOYED };
}
