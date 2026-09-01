import { AGENT_ROLES, ARTIFACT_TYPE, type AgentRole, type ArtifactType } from "@/lib/constants";
import { SYSTEM_PROMPTS } from "@/lib/agents/prompts";

export interface PipelineContext {
  title: string;
  description: string;
  /** Prior-stage artifacts, keyed by ArtifactType, in the order they were produced. */
  artifacts: Partial<Record<ArtifactType, string>>;
  /**
   * Set when the pipeline is looping back for rework — the QA report and/or a
   * reviewer's note. Every rework stage must address it exactly.
   */
  reworkNote?: string;
  reworkRound?: number;
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

/** Appended to rework stages so they fix exactly what was flagged. */
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

export const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  BA: {
    role: "BA",
    order: 0,
    label: "Business Analyst",
    artifactType: ARTIFACT_TYPE.REQUIREMENTS,
    withTools: false,
    webTools: false,
    maxTurns: 1,
    systemPrompt: SYSTEM_PROMPTS.BA,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}\nProduce the requirements document and acceptance criteria now.`,
  },

  ARCHITECT: {
    role: "ARCHITECT",
    order: 1,
    label: "Architect",
    artifactType: ARTIFACT_TYPE.DESIGN,
    withTools: true,
    webTools: true,
    maxTurns: 45,
    systemPrompt: SYSTEM_PROMPTS.ARCHITECT,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      priorArtifact(ctx, ARTIFACT_TYPE.REQUIREMENTS, "Requirements (from the Business Analyst)") +
      reworkSection(ctx) +
      `\nProduce the solution design (ADR) now. Inventory the instance with \`query\` for OOB / existing records before designing anything custom, confirm Fluent syntax with \`explain\`, and use \`WebSearch\` / \`WebFetch\` against ServiceNow's own sites for the best-practice pattern. The ADR must include the "Implementation guidance for the build team" section.`,
  },

  SENIOR_DEV: {
    role: "SENIOR_DEV",
    order: 2,
    label: "Senior Developer",
    artifactType: ARTIFACT_TYPE.TASK_LIST,
    withTools: true,
    webTools: false,
    maxTurns: 24,
    systemPrompt: SYSTEM_PROMPTS.SENIOR_DEV,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
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
    maxTurns: 55,
    systemPrompt: SYSTEM_PROMPTS.DEVELOPER,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      priorArtifact(ctx, ARTIFACT_TYPE.DESIGN, "Solution Design (from the Architect)") +
      priorArtifact(ctx, ARTIFACT_TYPE.TASK_LIST, "Implementation Plan (from the Senior Developer)") +
      reworkSection(ctx) +
      `\nImplement the task list now. The Architect's "Implementation guidance for the build team" is authoritative — every construct, OOB reference, and flow step in it must appear in your code, in order. Use \`explain\` for exact Fluent syntax. Emit ONLY file blocks in the required format.`,
  },

  QA: {
    role: "QA",
    order: 4,
    label: "QA",
    artifactType: ARTIFACT_TYPE.QA_REPORT,
    withTools: false,
    webTools: false,
    maxTurns: 2,
    systemPrompt: SYSTEM_PROMPTS.QA,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
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
