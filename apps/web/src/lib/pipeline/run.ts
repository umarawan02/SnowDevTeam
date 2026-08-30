import { prisma } from "@/lib/db";
import { STEP_STATUS, TICKET_STATUS, type ArtifactType } from "@/lib/constants";
import { config } from "@/lib/config";
import { PIPELINE, type PipelineContext } from "@/lib/agents/roles";
import { runAgent } from "@/lib/agents/runAgent";
import { resolveAgent } from "@/lib/agents/persona-prompt";

export interface PipelineResult {
  ok: boolean;
  ticketId: string;
  failedRole?: string;
  error?: string;
}

/**
 * Run the full BA → Architect → Senior Dev → Developer → QA pipeline for one
 * ticket, synchronously. Persists an AgentStep + Artifact after each stage.
 *
 * Any stage failure marks that step FAILED (with the error) and the ticket
 * FAILED, then stops — never a silent crash. On success the ticket ends
 * READY_FOR_REVIEW.
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

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: TICKET_STATUS.RUNNING },
  });

  const ctx: PipelineContext = {
    title: ticket.title,
    description: ticket.description,
    artifacts: {},
  };

  // On resume, load already-COMPLETE stages' artifacts into context and skip them.
  const completedOrders = new Set(
    ticket.steps.filter((s) => s.status === STEP_STATUS.COMPLETE).map((s) => s.order),
  );

  try {
    for (const stage of PIPELINE) {
      if (canResume && completedOrders.has(stage.order)) {
        const artifact = ticket.artifacts.find((a) => a.type === stage.artifactType);
        if (artifact) {
          ctx.artifacts[stage.artifactType as ArtifactType] = artifact.content;
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
