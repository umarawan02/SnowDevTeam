import fs from "node:fs";
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
  parseNativePlan,
  ticketDirName,
  ticketBranchName,
  type ReworkFrom,
} from "@/lib/pipeline/parse";
import { buildProject, relocateIntoTicketDir, withProjectLock } from "@/lib/nowsdk/workspace";
import { commitAll, discardTree, resetTicketBranch } from "@/lib/git/repo";
import { toProjectContext } from "@/lib/projects/resolve";
import { isNativeTier, isRouteTier, ROUTE_RANK, type RouteTier } from "@/lib/pipeline/route";
import type { Instance } from "@prisma/client";
import { buildProjectContext } from "@/lib/agents/project-context";
import { nativeTicketDir, writeScriptFiles } from "@/lib/nativeengine/scripts";
import { runValidation } from "@/lib/nativeengine/gate";
import { SnowClient } from "@/lib/servicenow/client";
import { dryRunDiff } from "@/lib/nativeengine/diff";
import { validatePlan } from "@/lib/nativeengine/plan";

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
/** Times the native plan gate re-runs the Developer to fix `validate_plan` errors. */
const MAX_PLAN_FIX = 2;

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

interface TicketForCtx {
  id: string;
  title: string;
  executionTier: string | null;
  tierRationale: string | null;
  routeScope: string | null;
  gitBranch: string | null;
  customer: { name: string; slug: string } | null;
  instance: Instance | null;
}

/**
 * The native-tier slice of the pipeline context (NATIVE_ENGINE_BRIEF §7): the
 * native prompt set + MCP server, the `{{PROJECT_CONTEXT}}` block, and the
 * ticket's native scripts dir. Just `{ projectContext }` for a Fluent ticket.
 */
function nativeCtx(ticket: TicketForCtx): Partial<PipelineContext> {
  const projectContext = buildProjectContext(ticket);
  if (!isNativeTier(ticket.executionTier)) return { projectContext };
  const slug = ticket.customer?.slug ?? "demo";
  const ticketDir = ticket.gitBranch?.replace(/^ticket\//, "") || ticketDirName(ticket.id, ticket.title);
  return {
    native: true,
    projectContext,
    instance: ticket.instance ?? undefined,
    nativeScriptsDir: nativeTicketDir(slug, ticketDir),
  };
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
 * Native quality gate (NATIVE_ENGINE_BRIEF §7) — replaces `runBuildGate` for the
 * native tier. Parse the Developer's output into a change plan + script files,
 * run the same read-only validation as the `validate_plan` tool, and on a clean
 * pass write the `CHANGE_PLAN` + `CHANGE_PLAN_DIFF` artifacts. On failure,
 * re-run the Developer with the findings, up to MAX_PLAN_FIX rounds.
 */
async function runPlanGate(ticketId: string, ctx: PipelineContext): Promise<{ ok: boolean; log: string }> {
  const scriptsDir = ctx.nativeScriptsDir;
  if (!scriptsDir) return { ok: false, log: "no native scripts dir on the context" };

  for (let attempt = 0; attempt <= MAX_PLAN_FIX; attempt++) {
    const parsed = parseNativePlan(ctx.artifacts[ARTIFACT_TYPE.CODE] ?? "");
    let ok = false;
    let diagnostics: string;
    let log: string;

    if (!parsed.planJson) {
      diagnostics = `No CHANGE_PLAN found.\n${parsed.warnings.join("\n")}\n\nEmit exactly one \`\`\`json block containing { "scope", "updateSetName", "changes": [...] }.`;
      log = `# Build (native)\n\n✗ ${diagnostics}`;
    } else {
      fs.mkdirSync(scriptsDir, { recursive: true });
      try {
        if (parsed.scripts.length) writeScriptFiles(scriptsDir, parsed.scripts);
      } catch (e) {
        // fall through — the validator will report the missing file
        log = "";
        void e;
      }

      let planInput: unknown;
      try {
        planInput = JSON.parse(parsed.planJson);
      } catch (e) {
        planInput = undefined;
        void e;
      }
      const scope = (planInput as { scope?: string })?.scope;
      const gate = await runValidation({
        planInput,
        scriptsDir,
        instance: ctx.instance ?? null,
        scopeKind: scope && scope !== "global" ? "scoped" : "global",
      });
      ok = gate.ok;
      diagnostics = gate.errors.join("\n");
      log =
        `# Build (native) — ${ok ? "PASSED" : `fix attempt ${attempt + 1} of ${MAX_PLAN_FIX + 1}`}\n\n` +
        `${gate.summary}\n` +
        (gate.errors.length ? `\n## Errors\n${gate.errors.map((e) => `- ${e}`).join("\n")}\n` : "") +
        (gate.warnings.length ? `\n## Warnings\n${gate.warnings.map((w) => `- ${w}`).join("\n")}\n` : "");

      if (ok) {
        await upsertArtifact(ticketId, ARTIFACT_TYPE.CHANGE_PLAN, parsed.planJson);
        ctx.artifacts[ARTIFACT_TYPE.CHANGE_PLAN as ArtifactType] = parsed.planJson;
        if (gate.diffMarkdown) {
          await upsertArtifact(ticketId, ARTIFACT_TYPE.CHANGE_PLAN_DIFF, gate.diffMarkdown);
        } else if (ctx.instance) {
          const v = validatePlan(planInput);
          if (v.plan) {
            const client = SnowClient.forInstance(ctx.instance);
            const diff = await dryRunDiff(v.plan, client);
            await upsertArtifact(ticketId, ARTIFACT_TYPE.CHANGE_PLAN_DIFF, diff.markdown);
          }
        }
      }
    }

    await upsertArtifact(ticketId, ARTIFACT_TYPE.BUILD_LOG, log);
    if (ok) return { ok: true, log };
    if (attempt === MAX_PLAN_FIX) return { ok: false, log };

    // Re-run the Developer against the findings + its own failing plan.
    ctx.planErrors = diagnostics;
    ctx.failingPlan = ctx.artifacts[ARTIFACT_TYPE.CODE] ?? "";
    await prisma.agentStep.deleteMany({ where: { ticketId, role: "DEVELOPER" } });
    await prisma.artifact.deleteMany({ where: { ticketId, type: ARTIFACT_TYPE.CODE } });
    delete ctx.artifacts[ARTIFACT_TYPE.CODE];
    const res = await runStages(ticketId, ctx, DEV_ORDER, DEV_ORDER, new Set(), [], { gateBuild: false });
    ctx.planErrors = undefined;
    ctx.failingPlan = undefined;
    if (!res.ok) return { ok: false, log: res.error ?? "developer re-run failed" };
  }
  return { ok: false, log: "plan gate exhausted" };
}

/**
 * Apply a `ROUTE_OVERRIDE: <TIER>` line from the Architect, but only if it is
 * *more conservative* than the current route (§6 / §7.3). A loosening override
 * is logged and ignored. NOT_SUPPORTED and a human flow route stop the pipeline.
 */
async function applyRouteOverride(
  ticketId: string,
  ctx: PipelineContext,
  architectText: string,
): Promise<{ stop?: PipelineResult } | null> {
  const m = architectText.match(/ROUTE_OVERRIDE:\s*([A-Z_]+)/);
  const want = m?.[1];
  if (!want || want === "none" || !isRouteTier(want)) return null;

  const current = (ctx.route?.tier ?? "NATIVE_GLOBAL") as RouteTier;
  if (!isRouteTier(current) || ROUTE_RANK[want] <= ROUTE_RANK[current]) {
    console.warn(`[route] Architect ROUTE_OVERRIDE ${want} is not more conservative than ${current} — ignored`);
    return null;
  }

  const rationale = `Route tightened by the Architect: ${current} → ${want}. ${architectText.slice(0, 800)}`;
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { executionTier: want, tierRationale: `Architect override: ${current} → ${want}` },
  });
  ctx.route = { ...(ctx.route ?? { scope: "", rationale: "" }), tier: want };
  ctx.native = isNativeTier(want);

  if (want === "NOT_SUPPORTED") {
    await upsertArtifact(ticketId, ARTIFACT_TYPE.DESIGN, `# Route: NOT_SUPPORTED\n\n${rationale}`);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
    return { stop: { ok: false, ticketId, error: `routed NOT_SUPPORTED by the Architect` } };
  }
  if (want === "FLUENT_FLOW" || want === "FLUENT_SCOPED_APP") {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.AWAITING_FLOW } });
    await upsertArtifact(ticketId, ARTIFACT_TYPE.DESIGN, `# Route: ${want} — awaiting a human\n\n${rationale}`);
    return { stop: { ok: true, ticketId } };
  }
  return null;
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

    const agent = await resolveAgent(stage.role, {
      native: !!ctx.native,
      projectContext: ctx.projectContext,
    });
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
        nowsdk:
          !ctx.native && ctx.project
            ? { projectDir: ctx.project.repoPath, ticketDir: ctx.ticketDir, defaultBranch: ctx.project.defaultBranch }
            : undefined,
        native:
          ctx.native && ctx.nativeScriptsDir
            ? { instance: ctx.instance ?? null, scriptsDir: ctx.nativeScriptsDir }
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

      // The Architect may argue for a more conservative route (§6 / §7.3).
      if (stage.role === "ARCHITECT" && ctx.native) {
        const applied = await applyRouteOverride(ticketId, ctx, result.text);
        if (applied?.stop) return applied.stop;
      }
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

    // Quality gate after the Developer, before QA.
    if (stage.role === "DEVELOPER" && opts.gateBuild !== false && endOrder >= QA_ORDER) {
      if (ctx.native) {
        // Native: parse + validate the change plan (validate_plan, read-only).
        const gate = await runPlanGate(ticketId, ctx);
        if (!gate.ok) {
          await prisma.agentStep.updateMany({
            where: { ticketId, role: "DEVELOPER" },
            data: {
              status: STEP_STATUS.FAILED,
              error: `The change plan did not validate after ${MAX_PLAN_FIX} fix attempts. See the Change Plan / Build tab.`,
              completedAt: new Date(),
            },
          });
          await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
          return { ok: false, ticketId, failedRole: "DEVELOPER", error: "plan gate failed" };
        }
      } else if (ctx.project) {
        // Fluent: the Developer's code must compile before QA sees it.
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
    include: { steps: true, artifacts: true, project: true, instance: true, customer: true },
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
    ...nativeCtx(ticket),
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
    include: { artifacts: { orderBy: { createdAt: "asc" } }, project: true, instance: true, customer: true },
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
    ...nativeCtx(ticket),
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
