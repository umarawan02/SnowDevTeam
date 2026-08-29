import { AGENT_ROLES, ARTIFACT_TYPE, type AgentRole, type ArtifactType } from "@/lib/constants";
import { SYSTEM_PROMPTS } from "@/lib/agents/prompts";

export interface PipelineContext {
  title: string;
  description: string;
  /** Prior-stage artifacts, keyed by ArtifactType, in the order they were produced. */
  artifacts: Partial<Record<ArtifactType, string>>;
}

export interface RoleConfig {
  role: AgentRole;
  order: number;
  label: string;
  artifactType: ArtifactType;
  /** Whether this agent gets the now-sdk `explain` / `query` MCP tools. */
  withTools: boolean;
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

export const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  BA: {
    role: "BA",
    order: 0,
    label: "Business Analyst",
    artifactType: ARTIFACT_TYPE.REQUIREMENTS,
    withTools: false,
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
    maxTurns: 30,
    systemPrompt: SYSTEM_PROMPTS.ARCHITECT,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      priorArtifact(ctx, ARTIFACT_TYPE.REQUIREMENTS, "Requirements (from the Business Analyst)") +
      `\nProduce the solution design (ADR) now. Use \`explain\` to confirm Fluent syntax and \`query\` to check the instance for naming conflicts.`,
  },

  SENIOR_DEV: {
    role: "SENIOR_DEV",
    order: 2,
    label: "Senior Developer",
    artifactType: ARTIFACT_TYPE.TASK_LIST,
    withTools: true,
    maxTurns: 24,
    systemPrompt: SYSTEM_PROMPTS.SENIOR_DEV,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      priorArtifact(ctx, ARTIFACT_TYPE.REQUIREMENTS, "Requirements (from the Business Analyst)") +
      priorArtifact(ctx, ARTIFACT_TYPE.DESIGN, "Solution Design (from the Architect)") +
      `\nProduce the implementation plan, file plan, and review checklist now.`,
  },

  DEVELOPER: {
    role: "DEVELOPER",
    order: 3,
    label: "Developer",
    artifactType: ARTIFACT_TYPE.CODE,
    withTools: true,
    maxTurns: 55,
    systemPrompt: SYSTEM_PROMPTS.DEVELOPER,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      priorArtifact(ctx, ARTIFACT_TYPE.DESIGN, "Solution Design (from the Architect)") +
      priorArtifact(ctx, ARTIFACT_TYPE.TASK_LIST, "Implementation Plan (from the Senior Developer)") +
      `\nImplement the task list now. Use \`explain\` for exact Fluent syntax. Emit ONLY file blocks in the required format.`,
  },

  QA: {
    role: "QA",
    order: 4,
    label: "QA",
    artifactType: ARTIFACT_TYPE.QA_REPORT,
    withTools: false,
    maxTurns: 2,
    systemPrompt: SYSTEM_PROMPTS.QA,
    buildUserPrompt: (ctx) =>
      `${request(ctx)}` +
      priorArtifact(ctx, ARTIFACT_TYPE.REQUIREMENTS, "Requirements (from the Business Analyst)") +
      priorArtifact(ctx, ARTIFACT_TYPE.DESIGN, "Solution Design (from the Architect)") +
      priorArtifact(ctx, ARTIFACT_TYPE.TASK_LIST, "Implementation Plan + Review Checklist (from the Senior Developer)") +
      priorArtifact(ctx, ARTIFACT_TYPE.CODE, "Generated Code (from the Developer)") +
      `\nProduce the QA report now. End with the single VERDICT line.`,
  },
};

/** Roles in pipeline execution order. */
export const PIPELINE: RoleConfig[] = AGENT_ROLES.map((r) => ROLE_CONFIG[r]);
