import { prisma } from "@/lib/db";
import {
  STEP_STATUS,
  TICKET_STATUS,
  ARTIFACT_TYPE,
  type ArtifactType,
} from "@/lib/constants";
import { config } from "@/lib/config";
import { PIPELINE, ROLE_CONFIG, type PipelineContext } from "@/lib/agents/roles";
import { runAgent } from "@/lib/agents/runAgent";
import { resolveAgent } from "@/lib/agents/persona-prompt";
import { parseQaVerdict, parseReworkFrom, type ReworkFrom } from "@/lib/pipeline/parse";

export interface PipelineResult {
  ok: boolean;
  ticketId: string;
  failedRole?: string;
  error?: string;
}

/** Auto rework rounds the pipeline will run itself before handing to the human. */
const MAX_AUTO_REWORK = 2;

const DEPLOY_ARTIFACTS: ArtifactType[] = [
  ARTIFACT_TYPE.DEPLOY_LOG,
  ARTIFACT_TYPE.DEPLOY_VERIFICATION,
];

function artifactTypesFrom(fromOrder: number): ArtifactType[] {
  return PIPELINE.filter((s) => s.order >= fromOrder).map((s) => s.artifactType);
}

/** Delete the steps + artifacts for `fromOrder..QA` (plus any deploy artifacts). */
async function resetFrom(ticketId: string, fromOrder: number): Promise<void> {
  const roles = PIPELINE.filter((s) => s.order >= fromOrder).map((s) => s.role);
  await prisma.agentStep.deleteMany({ where: { ticketId, role: { in: roles } } });
  await prisma.artifact.deleteMany({
    where: { ticketId, type: { in: [...artifactTypesFrom(fromOrder), ...DEPLOY_ARTIFACTS] } },
  });
}

/**
 * Run pipeline stages from `startOrder` onward, writing a step + artifact per
 * stage. On a stage failure: mark the step + ticket FAILED and return.
 */
async function runStages(
  ticketId: string,
  ctx: PipelineContext,
  startOrder: number,
  skipCompleted: Set<number>,
  existingArtifacts: { type: string; content: string }[],
): Promise<PipelineResult> {
  for (const stage of PIPELINE) {
    if (stage.order < startOrder) continue;

    if (skipCompleted.has(stage.order)) {
      const a = existingArtifacts.find((x) => x.type === stage.artifactType);
      if (a) {
        ctx.artifacts[stage.artifactType as ArtifactType] = a.content;
        continue;
      }
    }

    const agent = await resolveAgent(stage.role);
    const modelUsed = agent.model ?? config.ANTHROPIC_MODEL;

    const step = await prisma.agentStep.upsert({
      where: { ticketId_order: { ticketId, order: stage.order } },
      create: {
        ticketId,
        role: stage.role,
        order: stage.order,
        status: STEP_STATUS.RUNNING,
        personaName: agent.personaName,
        model: modelUsed,
        startedAt: new Date(),
      },
      update: {
        status: STEP_STATUS.RUNNING,
        personaName: agent.personaName,
        model: modelUsed,
        startedAt: new Date(),
        completedAt: null,
        output: null,
        error: null,
      },
    });

    try {
      const result = await runAgent({
        systemPrompt: agent.systemPrompt,
        userPrompt: stage.buildUserPrompt(ctx),
        maxTurns: stage.maxTurns,
        withTools: stage.withTools,
        webTools: stage.webTools,
        model: agent.model,
      });

      await prisma.agentStep.update({
        where: { id: step.id },
        data: {
          status: STEP_STATUS.COMPLETE,
          output: result.text,
          costUsd: result.costUsd,
          numTurns: result.numTurns,
          completedAt: new Date(),
        },
      });

      // On a rework pass the stage's artifact was deleted — create fresh.
      await prisma.artifact.create({
        data: { ticketId, type: stage.artifactType, content: result.text },
      });
      ctx.artifacts[stage.artifactType as ArtifactType] = result.text;
    } catch (stageErr) {
      const message = stageErr instanceof Error ? stageErr.message : String(stageErr);
      await prisma.agentStep.update({
        where: { id: step.id },
        data: { status: STEP_STATUS.FAILED, error: message, completedAt: new Date() },
      });
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TICKET_STATUS.FAILED },
      });
      return { ok: false, ticketId, failedRole: stage.role, error: message };
    }
  }
  return { ok: true, ticketId };
}

/**
 * After a QA pass, loop back for automatic rework while QA says NEEDS_REWORK and
 * we're under the cap. Each round re-runs from the stage QA points at
 * (`REWORK_FROM`, default DEVELOPER) with the QA report as a must-fix directive.
 */
async function autoReworkLoop(ticketId: string, ctx: PipelineContext, startRound: number): Promise<PipelineResult> {
  let round = startRound;
  for (;;) {
    const qaText = ctx.artifacts[ARTIFACT_TYPE.QA_REPORT] ?? "";
    if (parseQaVerdict(qaText) !== "NEEDS_REWORK") return { ok: true, ticketId };
    if (round >= MAX_AUTO_REWORK) return { ok: true, ticketId };

    round += 1;
    const fromRole: ReworkFrom = parseReworkFrom(qaText) ?? "DEVELOPER";
    const fromOrder = ROLE_CONFIG[fromRole].order;

    await resetFrom(ticketId, fromOrder);
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { reworkRound: round, reworkReason: qaText.slice(0, 6000) },
    });

    for (const t of artifactTypesFrom(fromOrder)) delete ctx.artifacts[t as ArtifactType];
    ctx.reworkNote = qaText;
    ctx.reworkRound = round;

    const res = await runStages(ticketId, ctx, fromOrder, new Set(), []);
    if (!res.ok) return res;
  }
}

/**
 * Run the full BA → Architect → Senior Dev → Developer → QA pipeline for one
 * ticket, synchronously, then loop back for up to MAX_AUTO_REWORK rounds of
 * automatic QA-driven rework. On success the ticket ends READY_FOR_REVIEW; any
 * stage failure marks that step + the ticket FAILED and stops.
 */
export async function runPipeline(
  ticketId: string,
  opts: { resume?: boolean } = {},
): Promise<PipelineResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { steps: true, artifacts: true },
  });
  if (!ticket) return { ok: false, ticketId, error: "ticket not found" };

  const RESUMABLE = [TICKET_STATUS.FAILED, TICKET_STATUS.RUNNING];
  const canResume = opts.resume && RESUMABLE.includes(ticket.status as (typeof RESUMABLE)[number]);
  if (ticket.status !== TICKET_STATUS.PENDING && !canResume) {
    return {
      ok: false,
      ticketId,
      error: `ticket is ${ticket.status}; expected PENDING (or pass resume:true for FAILED/RUNNING)`,
    };
  }

  await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.RUNNING } });

  const ctx: PipelineContext = { title: ticket.title, description: ticket.description, artifacts: {} };
  const skipCompleted = canResume
    ? new Set(ticket.steps.filter((s) => s.status === STEP_STATUS.COMPLETE).map((s) => s.order))
    : new Set<number>();

  try {
    const first = await runStages(ticketId, ctx, 0, skipCompleted, ticket.artifacts);
    if (!first.ok) return first;

    const rework = await autoReworkLoop(ticketId, ctx, ticket.reworkRound);
    if (!rework.ok) return rework;

    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TICKET_STATUS.READY_FOR_REVIEW },
    });
    return { ok: true, ticketId };
  } catch (fatal) {
    const message = fatal instanceof Error ? fatal.message : String(fatal);
    await prisma.ticket
      .update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } })
      .catch(() => {});
    return { ok: false, ticketId, error: message };
  }
}

/**
 * Human-initiated rework from the review gate: re-run `fromRole..QA` with the
 * reviewer's note (plus the latest QA report) as the directive, then return to
 * the gate. No automatic loop — the reviewer is driving.
 */
export async function runRework(
  ticketId: string,
  input: { fromRole: ReworkFrom; note: string; reviewerId?: string | null },
): Promise<PipelineResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return { ok: false, ticketId, error: "ticket not found" };

  const deployLog = [...ticket.artifacts].reverse().find((a) => a.type === ARTIFACT_TYPE.DEPLOY_LOG);
  const isDeployFailure = ticket.status === TICKET_STATUS.FAILED && !!deployLog;
  if (ticket.status !== TICKET_STATUS.READY_FOR_REVIEW && !isDeployFailure) {
    return {
      ok: false,
      ticketId,
      error: `ticket is ${ticket.status}; only a READY_FOR_REVIEW ticket or a deploy-build failure can be reworked`,
    };
  }

  const qaText =
    [...ticket.artifacts].reverse().find((a) => a.type === ARTIFACT_TYPE.QA_REPORT)?.content ?? "";
  const directive = [
    input.note.trim(),
    isDeployFailure
      ? `\n\n---\n\n## The last build failed — fix these errors\n\nThe generated code did not pass \`now-sdk build\`. Every error below must be gone.\n\n${deployLog!.content}`
      : "",
    qaText ? `\n\n---\n\n## Latest QA report\n\n${qaText}` : "",
  ]
    .filter(Boolean)
    .join("");

  const round = ticket.reworkRound + 1;
  const fromOrder = ROLE_CONFIG[input.fromRole].order;

  const ctx: PipelineContext = {
    title: ticket.title,
    description: ticket.description,
    artifacts: {},
    reworkNote: directive,
    reworkRound: round,
  };
  // Surviving earlier artifacts stay in context.
  for (const a of ticket.artifacts) {
    const stage = PIPELINE.find((s) => s.artifactType === a.type);
    if (stage && stage.order < fromOrder) ctx.artifacts[a.type as ArtifactType] = a.content;
  }

  await resetFrom(ticketId, fromOrder);
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: TICKET_STATUS.RUNNING,
      reworkRound: round,
      reworkReason: input.note.trim().slice(0, 6000),
      ...(input.reviewerId ? { reviewedById: input.reviewerId } : {}),
    },
  });

  try {
    const res = await runStages(ticketId, ctx, fromOrder, new Set(), []);
    if (!res.ok) return res;
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TICKET_STATUS.READY_FOR_REVIEW },
    });
    return { ok: true, ticketId };
  } catch (fatal) {
    const message = fatal instanceof Error ? fatal.message : String(fatal);
    await prisma.ticket
      .update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } })
      .catch(() => {});
    return { ok: false, ticketId, error: message };
  }
}
