import {
  AGENT_ROLES,
  ARTIFACT_TYPE,
  DEFAULT_TARGET_SCOPE,
  type AgentRole,
  type ArtifactType,
  type TargetScope,
} from "@/lib/constants";
import { SYSTEM_PROMPTS } from "@/lib/agents/prompts";

/** Cheaper model for the near-deterministic stages (template fill, sequencing). */
const MODEL_FAST = "claude-haiku-4-5-20251001";

export interface PipelineContext {
  title: string;
  description: string;
  /** Prior-stage artifacts, keyed by ArtifactType, in the order they were produced. */
  artifacts: Partial<Record<ArtifactType, string>>;
  /** Where this ticket is built/deployed — "global" (default) or "scoped". */
  targetScope: TargetScope;
  /**
   * Set when the pipeline is looping back for rework — the QA report and/or a
   * reviewer's note. Every rework stage must address it exactly.
   */
  reworkNote?: string;
  reworkRound?: number;
  /** Set by the build gate: the `now-sdk build` diagnostics + the failing code,
   *  so the Developer re-runs cheaply (no design/task-list re-send). */
  buildErrors?: string;
  failingCode?: string;
}

export interface RoleConfig {
  role: AgentRole;
  order: number;
  label: string;
  artifactType: ArtifactType;
  /** Whether this agent gets the now-sdk `explain` / `query` MCP tools. */
  withTools: boolean;
  /** Whether this agent also gets WebSearch / WebFetch (Architect only). */
  webTools: boolean;
  /** Whether this agent gets the `build` tool — compile draft code (Developer only). */
  buildTool: boolean;
  /** Default model tier for this role; a persona override still wins. */
  model?: string;
  maxTurns: number;
  systemPrompt: string;
  buildUserPrompt: (ctx: PipelineContext) => string;
}

function section(heading: string, body: string): string {
  return `\n## ${heading}\n\n${body.trim()}\n`;
}

function priorArtifact(ctx: PipelineContext, type: ArtifactType, heading: string): string {
  const content = ctx.artifacts[type];
  return content ? section(heading, content) : "";
}

const request = (ctx: PipelineContext) =>
  `# Customer feature request\n\n**Title:** ${ctx.title}\n\n**Description:**\n\n${ctx.description.trim()}\n`;

/** The one authoring rule that differs by target scope — prepended to every stage. */
function scopeSection(ctx: PipelineContext): string {
  if ((ctx.targetScope ?? DEFAULT_TARGET_SCOPE) === "scoped") {
    return section(
      "Target scope — SCOPED",
      "Build inside the scoped application `x_1460392_delivery` (\"AI Delivery App\"). " +
        "Every net-new table/field carries the app prefix. A scoped app **cannot** own a " +
        "UI policy, business rule, client script, or ACL on an OOB table (`sysapproval_approver`, " +
        "`sc_task`, `sc_req_item`, …) — put that logic in a Flow instead.",
    );
  }
  return section(
    "Target scope — GLOBAL",
    "Build plain platform-wide records. Do **not** prefix `Now.ID` keys, table names, or " +
      "field names with `x_1460392_delivery_` — use short kebab-case ids (e.g. `laptop-request`). " +
      "Avoid custom tables; if one is truly unavoidable, use a `u_` prefix. You may reference OOB " +
      "records directly and, where the design calls for it, attach UI policies / business rules / " +
      "ACLs to OOB tables — the scoped-app cross-scope restrictions do not apply.",
  );
}

/** Appended to a rework stage so it fixes exactly what QA / the reviewer flagged. */
function reworkSection(ctx: PipelineContext): string {
  if (!ctx.reworkNote) return "";
  return section(
    `Rework — round ${ctx.reworkRound ?? 1}`,
    `This work was sent back. You **must address every BLOCKER and every required ` +
      `fix below, exactly** — do not change anything that already passed review, and ` +
      `do not introduce new scope. When you are done, everything listed here must be ` +
      `resolved.\n\n${ctx.reworkNote}`,
  );
}

/**
 * A build-fix round: the Developer already produced design-conformant code that
 * has a compile error. Send just that code + the errors — not the design and
 * task list again.
 */
function buildFixPrompt(ctx: PipelineContext): string {
  return (
    request(ctx) +
    section("Your current code — it does NOT compile", ctx.failingCode ?? "(missing)") +
    section(
      "`now-sdk build` errors — fix ONLY these",
      "```text\n" + (ctx.buildErrors ?? "") + "\n```",
    ) +
    `\nEdit only the file(s) named in the errors; leave every other file byte-for-byte ` +
    `as it is. Do not change scope, behaviour, or anything that already compiled. Use ` +
    `\`explain\` if you need the correct syntax for the failing construct, then call ` +
    `\`build\` to confirm exit 0. Re-emit the **complete** corrected file set in the ` +
    `required file-block format.`
  );
}

export const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  BA: {
    role: "BA",
    order: 0,
    label: "Business Analyst",
    artifactType: ARTIFACT_TYPE.REQUIREMENTS,
    withTools: false,
    webTools: false,
    buildTool: false,
    model: MODEL_FAST,
    maxTurns: 1,
    systemPrompt: SYSTEM_PROMPTS.BA,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      scopeSection(ctx) +
      `\nProduce the requirements document and acceptance criteria now. Note the target scope in your summary.`,
  },

  ARCHITECT: {
    role: "ARCHITECT",
    order: 1,
    label: "Architect",
    artifactType: ARTIFACT_TYPE.DESIGN,
    withTools: true,
    webTools: true,
    buildTool: false,
    maxTurns: 30,
    systemPrompt: SYSTEM_PROMPTS.ARCHITECT,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      scopeSection(ctx) +
      priorArtifact(ctx, ARTIFACT_TYPE.REQUIREMENTS, "Requirements (from the Business Analyst)") +
      reworkSection(ctx) +
      `\nProduce the solution design (ADR) now. Inventory the instance with \`query\` for OOB / existing records before designing anything custom, and confirm Fluent syntax with \`explain\`. The standard catalog-item + approval + fulfillment pattern is already in the Appendix — do **not** research it. The ADR must include the "Implementation guidance for the build team" section.`,
  },

  SENIOR_DEV: {
    role: "SENIOR_DEV",
    order: 2,
    label: "Senior Developer",
    artifactType: ARTIFACT_TYPE.TASK_LIST,
    withTools: true,
    webTools: false,
    buildTool: false,
    model: MODEL_FAST,
    maxTurns: 24,
    systemPrompt: SYSTEM_PROMPTS.SENIOR_DEV,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      scopeSection(ctx) +
      priorArtifact(ctx, ARTIFACT_TYPE.REQUIREMENTS, "Requirements (from the Business Analyst)") +
      priorArtifact(ctx, ARTIFACT_TYPE.DESIGN, "Solution Design (from the Architect)") +
      reworkSection(ctx) +
      `\nProduce the implementation plan, file plan, and review checklist now. Follow the Architect's "Implementation guidance for the build team" exactly.`,
  },

  DEVELOPER: {
    role: "DEVELOPER",
    order: 3,
    label: "Developer",
    artifactType: ARTIFACT_TYPE.CODE,
    withTools: true,
    webTools: false,
    buildTool: true,
    maxTurns: 55,
    systemPrompt: SYSTEM_PROMPTS.DEVELOPER,
    buildUserPrompt: (ctx) =>
      ctx.buildErrors && ctx.failingCode
        ? buildFixPrompt(ctx)
        : `${request(ctx)}` +
          scopeSection(ctx) +
          priorArtifact(ctx, ARTIFACT_TYPE.DESIGN, "Solution Design (from the Architect)") +
          priorArtifact(ctx, ARTIFACT_TYPE.TASK_LIST, "Implementation Plan (from the Senior Developer)") +
          reworkSection(ctx) +
          `\nImplement the task list now. The Architect's "Implementation guidance for the build team" is authoritative — every construct, OOB reference, and flow step in it must appear in your code, in order. Use \`explain\` for exact Fluent syntax and call \`build\` until it exits 0 before you finish. Emit ONLY file blocks in the required format.`,
  },

  QA: {
    role: "QA",
    order: 4,
    label: "QA",
    artifactType: ARTIFACT_TYPE.QA_REPORT,
    withTools: false,
    webTools: false,
    buildTool: false,
    maxTurns: 2,
    systemPrompt: SYSTEM_PROMPTS.QA,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      scopeSection(ctx) +
      priorArtifact(ctx, ARTIFACT_TYPE.REQUIREMENTS, "Requirements (from the Business Analyst)") +
      priorArtifact(ctx, ARTIFACT_TYPE.DESIGN, "Solution Design (from the Architect)") +
      priorArtifact(ctx, ARTIFACT_TYPE.TASK_LIST, "Implementation Plan + Review Checklist (from the Senior Developer)") +
      priorArtifact(ctx, ARTIFACT_TYPE.CODE, "Generated Code (from the Developer)") +
      reworkSection(ctx) +
      `\nProduce the QA report now. End with the VERDICT line, and — if NEEDS_REWORK — the REWORK_FROM line.`,
  },
};

/** Roles in pipeline execution order. */
export const PIPELINE: RoleConfig[] = AGENT_ROLES.map((r) => ROLE_CONFIG[r]);
