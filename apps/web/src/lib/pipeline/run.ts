import { prisma } from "@/lib/db";
import { STEP_STATUS, TICKET_STATUS, ARTIFACT_TYPE, type ArtifactType } from "@/lib/constants";
import { config } from "@/lib/config";
import { PIPELINE, ROLE_CONFIG, type PipelineContext } from "@/lib/agents/roles";
import { runAgent } from "@/lib/agents/runAgent";
import { resolveAgent } from "@/lib/agents/persona-prompt";
import {
  parseQaVerdict,
  parseReworkFrom,
  parseGeneratedFiles,
  ticketDirName,
  ticketBranchName,
  type ReworkFrom,
} from "@/lib/pipeline/parse";
import { buildProject, relocateIntoTicketDir, withProjectLock } from "@/lib/nowsdk/workspace";
import { commitAll, discardTree, resetTicketBranch } from "@/lib/git/repo";
import { toProjectContext } from "@/lib/projects/resolve";

export interface PipelineResult {
  ok: boolean;
  ticketId: string;
  failedRole?: string;
  error?: string;
}

/** Auto rework rounds the pipeline will run itself before handing to the human. */
const MAX_AUTO_REWORK = 2;
/** Times the build gate re-runs the Developer to fix compile errors before failing. */
const MAX_BUILD_FIX = 2;

const DEV_ORDER = ROLE_CONFIG.DEVELOPER.order;
const QA_ORDER = ROLE_CONFIG.QA.order;

const DERIVED_ARTIFACTS: ArtifactType[] = [
  ARTIFACT_TYPE.BUILD_LOG,
  ARTIFACT_TYPE.DEPLOY_LOG,
  ARTIFACT_TYPE.DEPLOY_VERIFICATION,
];

/**
 * Build `PipelineContext.project` from the ticket's resolved FluentProject row.
 * A ticket reaching the pipeline without a project is a wiring bug (every
 * creation path resolves one before calling runPipeline) — fail loudly rather
 * than silently falling back to a shared workspace.
 */
function projectContextOf(ticket: {
  executionTier: string | null;
  project: Parameters<typeof toProjectContext>[0] | null;
}): PipelineContext["project"] {
  if (!ticket.project) {
    // Native-tier tickets (NATIVE_ENGINE_BRIEF §6) have no Fluent project/repo —
    // the pipeline runs the agent stages without the build machinery.
    if (ticket.executionTier?.startsWith("NATIVE")) return undefined;
    throw new Error(
      "ticket has no FluentProject assigned — resolveProjectForTicket must run before runPipeline",
    );
  }
  return toProjectContext(ticket.project);
}

function artifactTypesFrom(fromOrder: number): ArtifactType[] {
  return PIPELINE.filter((s) => s.order >= fromOrder).map((s) => s.artifactType);
}

/** Delete the steps + artifacts for `fromOrder..QA` (plus any deploy artifacts). */
async function resetFrom(ticketId: string, fromOrder: number): Promise<void> {
  const roles = PIPELINE.filter((s) => s.order >= fromOrder).map((s) => s.role);
  await prisma.agentStep.deleteMany({ where: { ticketId, role: { in: roles } } });
  await prisma.artifact.deleteMany({
    where: { ticketId, type: { in: [...artifactTypesFrom(fromOrder), ...DERIVED_ARTIFACTS] } },
  });
}

/**
 * Compile-check the Developer's code before it reaches QA (REFACTOR_BRIEF
 * Phase 2 — the build now runs over the *whole* project on the ticket's own
 * git branch). The ticket's files land in `src/fluent/<ticketDir>/`; a clean
 * build commits the branch, a failed build discards the tree and re-runs the
 * Developer with the diagnostics, up to MAX_BUILD_FIX rounds.
 */
async function runBuildGate(ticketId: string, ctx: PipelineContext): Promise<{ ok: boolean; log: string }> {
  if (!ctx.project) throw new Error("runBuildGate called for a ticket with no Fluent project");
  const repo = ctx.project.repoPath;
  const branch = ticketBranchName(ctx.ticketDir);
  const base = ctx.project.defaultBranch;

  for (let attempt = 0; attempt <= MAX_BUILD_FIX; attempt++) {
    const parsed = parseGeneratedFiles(ctx.artifacts[ARTIFACT_TYPE.CODE] ?? "");
    const { files, rejected } = relocateIntoTicketDir(parsed.files, ctx.ticketDir);

    let ok = false;
    let diagnostics: string;
    let log: string;

    if (files.length === 0 || rejected.length > 0) {
      diagnostics = rejected.length
        ? `These paths are outside your ticket directory — emit plain names only ` +
          `(the orchestrator files them under src/fluent/${ctx.ticketDir}/):\n${rejected.join("\n")}`
        : `No parseable \`=== FILE: … ===\` blocks in your output.\n${parsed.warnings.join("\n")}`;
      log = `# Build\n\n✗ ${diagnostics}`;
    } else {
      const build = await withProjectLock(repo, async () => {
        await resetTicketBranch(repo, branch, base);
        const r = await buildProject(repo, ctx.ticketDir, files);
        if (r.code === 0) {
          await commitAll(repo, `ticket ${ticketId.slice(-6)}: ${ctx.title}`.slice(0, 100));
        } else {
          await discardTree(repo, base);
        }
        return r;
      });
      ok = build.code === 0;
      diagnostics = build.diagnostics;
      const output = [build.stdout, build.stderr].filter(Boolean).join("\n").trim() || "(no output)";
      log = ok
        ? `# Build\n\n✓ \`now-sdk build\` passed (exit 0) — ${build.fileCount} file(s) under ` +
          `src/fluent/${ctx.ticketDir}/\n\n\`\`\`text\n${output}\n\`\`\`\n`
        : `# Build\n\n✗ \`now-sdk build\` failed (exit ${build.code}) — fix attempt ${attempt + 1} of ` +
          `${MAX_BUILD_FIX + 1}\n\n\`\`\`text\n${output}\n\`\`\`\n`;
    }

    await upsertArtifact(ticketId, ARTIFACT_TYPE.BUILD_LOG, log);

    if (ok) {
      await prisma.ticket.update({ where: { id: ticketId }, data: { gitBranch: branch } });
      return { ok: true, log };
    }
    if (attempt === MAX_BUILD_FIX) return { ok: false, log };

    // Re-run the Developer against the diagnostics + its own failing code —
    // no design / task-list re-send (buildFixPrompt in roles.ts).
    ctx.buildErrors = diagnostics;
    ctx.failingCode = ctx.artifacts[ARTIFACT_TYPE.CODE] ?? "";
    await prisma.agentStep.deleteMany({ where: { ticketId, role: "DEVELOPER" } });
    await prisma.artifact.deleteMany({ where: { ticketId, type: ARTIFACT_TYPE.CODE } });
    delete ctx.artifacts[ARTIFACT_TYPE.CODE];
    const res = await runStages(ticketId, ctx, DEV_ORDER, DEV_ORDER, new Set(), [], { gateBuild: false });
    ctx.buildErrors = undefined;
    ctx.failingCode = undefined;
    if (!res.ok) return { ok: false, log: res.error ?? "developer re-run failed" };
  }
  return { ok: false, log: "build gate exhausted" };
}

async function upsertArtifact(ticketId: string, type: string, content: string): Promise<void> {
  const existing = await prisma.artifact.findFirst({ where: { ticketId, type } });
  if (existing) await prisma.artifact.update({ where: { id: existing.id }, data: { content } });
  else await prisma.artifact.create({ data: { ticketId, type, content } });
}

/**
 * Run pipeline stages `startOrder..endOrder` (inclusive), writing a step +
 * artifact per stage. After the Developer stage (unless `opts.gateBuild` is
 * false) the build gate runs. On a stage or gate failure: mark the step + ticket
 * FAILED and return.
 */
async function runStages(
  ticketId: string,
  ctx: PipelineContext,
  startOrder: number,
  endOrder: number,
  skipCompleted: Set<number>,
  existingArtifacts: { type: string; content: string }[],
  opts: { gateBuild?: boolean } = {},
): Promise<PipelineResult> {
  for (const stage of PIPELINE) {
    if (stage.order < startOrder || stage.order > endOrder) continue;

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
        buildTool: stage.buildTool,
        nowsdk: ctx.project
          ? {
              projectDir: ctx.project.repoPath,
              ticketDir: ctx.ticketDir,
              defaultBranch: ctx.project.defaultBranch,
            }
          : undefined,
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

    // Build gate: the Developer's code must compile before QA sees it. Native
    // tickets have no Fluent build — the quality gate is Phase 7's validate_plan.
    if (stage.role === "DEVELOPER" && ctx.project && opts.gateBuild !== false && endOrder >= QA_ORDER) {
      const gate = await runBuildGate(ticketId, ctx);
      if (!gate.ok) {
        await prisma.agentStep.updateMany({
          where: { ticketId, role: "DEVELOPER" },
          data: {
            status: STEP_STATUS.FAILED,
            error: `Code did not compile after ${MAX_BUILD_FIX} fix attempts. See the Build tab.`,
            completedAt: new Date(),
          },
        });
        await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
        return { ok: false, ticketId, failedRole: "DEVELOPER", error: "build gate failed" };
      }
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

    const res = await runStages(ticketId, ctx, fromOrder, QA_ORDER, new Set(), []);
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
    include: { steps: true, artifacts: true, project: true },
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

  const project = projectContextOf(ticket);
  const ctx: PipelineContext = {
    ticketId,
    title: ticket.title,
    description: ticket.description,
    artifacts: {},
    targetScope: project?.kind ?? "global",
    project,
    route: ticket.executionTier
      ? {
          tier: ticket.executionTier,
          scope: ticket.routeScope ?? project?.scope ?? "global",
          rationale: ticket.tierRationale ?? "",
        }
      : undefined,
    ticketDir: ticketDirName(ticketId, ticket.title),
  };
  const skipCompleted = canResume
    ? new Set(ticket.steps.filter((s) => s.status === STEP_STATUS.COMPLETE).map((s) => s.order))
    : new Set<number>();

  try {
    const first = await runStages(ticketId, ctx, 0, QA_ORDER, skipCompleted, ticket.artifacts);
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
    include: { artifacts: { orderBy: { createdAt: "asc" } }, project: true },
  });
  if (!ticket) return { ok: false, ticketId, error: "ticket not found" };

  const rev = [...ticket.artifacts].reverse();
  const buildLog =
    rev.find((a) => a.type === ARTIFACT_TYPE.BUILD_LOG) ??
    rev.find((a) => a.type === ARTIFACT_TYPE.DEPLOY_LOG);
  const isBuildFailure = ticket.status === TICKET_STATUS.FAILED && !!buildLog;
  if (ticket.status !== TICKET_STATUS.READY_FOR_REVIEW && !isBuildFailure) {
    return {
      ok: false,
      ticketId,
      error: `ticket is ${ticket.status}; only a READY_FOR_REVIEW ticket or a build failure can be reworked`,
    };
  }

  const qaText = rev.find((a) => a.type === ARTIFACT_TYPE.QA_REPORT)?.content ?? "";
  const directive = [
    input.note.trim(),
    isBuildFailure
      ? `\n\n---\n\n## The last build failed — fix these errors\n\nThe generated code did not pass \`now-sdk build\`. Every error below must be gone.\n\n${buildLog!.content}`
      : "",
    qaText ? `\n\n---\n\n## Latest QA report\n\n${qaText}` : "",
  ]
    .filter(Boolean)
    .join("");

  const round = ticket.reworkRound + 1;
  const fromOrder = ROLE_CONFIG[input.fromRole].order;

  const project = projectContextOf(ticket);
  const ctx: PipelineContext = {
    ticketId,
    title: ticket.title,
    description: ticket.description,
    artifacts: {},
    targetScope: project?.kind ?? "global",
    project,
    route: ticket.executionTier
      ? {
          tier: ticket.executionTier,
          scope: ticket.routeScope ?? project?.scope ?? "global",
          rationale: ticket.tierRationale ?? "",
        }
      : undefined,
    ticketDir: ticketDirName(ticketId, ticket.title),
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
    const res = await runStages(ticketId, ctx, fromOrder, QA_ORDER, new Set(), []);
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
