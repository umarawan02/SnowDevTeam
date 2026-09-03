// Single source of truth for the string-valued enums stored in SQLite.
// Kept as plain string unions (not Prisma enums) to avoid SQLite enum
// migration friction. The pipeline orchestration (Phase 1) imports from here.

export const TICKET_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  DEPLOYING: "DEPLOYING",
  FAILED: "FAILED",
  DEPLOYED: "DEPLOYED",
  REJECTED: "REJECTED",
} as const;
export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

export const STEP_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
} as const;
export type StepStatus = (typeof STEP_STATUS)[keyof typeof STEP_STATUS];

// Pipeline roles in execution order.
export const AGENT_ROLES = [
  "BA",
  "ARCHITECT",
  "SENIOR_DEV",
  "DEVELOPER",
  "QA",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

// Where the pipeline builds/deploys a ticket's artifacts.
// "global" — plain platform-wide records (the default, what most catalog
// items want). "scoped" — the x_1460392_delivery application.
export const TARGET_SCOPES = ["global", "scoped"] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];
export const DEFAULT_TARGET_SCOPE: TargetScope = "global";

export const ARTIFACT_TYPE = {
  REQUIREMENTS: "REQUIREMENTS",
  DESIGN: "DESIGN",
  TASK_LIST: "TASK_LIST",
  CODE: "CODE",
  BUILD_LOG: "BUILD_LOG",
  TEST_PLAN: "TEST_PLAN",
  QA_REPORT: "QA_REPORT",
  DEPLOY_LOG: "DEPLOY_LOG",
  DEPLOY_VERIFICATION: "DEPLOY_VERIFICATION",
} as const;
export type ArtifactType = (typeof ARTIFACT_TYPE)[keyof typeof ARTIFACT_TYPE];
