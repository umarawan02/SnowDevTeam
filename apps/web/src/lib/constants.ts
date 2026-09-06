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
  // NATIVE_ENGINE_BRIEF §6.3 route 4: the design needs a Flow Designer flow
  // that no one will build automatically — the ticket waits for a human.
  AWAITING_FLOW: "AWAITING_FLOW",
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

// Where the pipeline builds/deploys a ticket's artifacts. Historically the
// only axis of choice (one hard-coded global app + one hard-coded scoped
// app); now mirrors FluentProject.kind for a given customer. Kept as the
// intake-time signal until tier.ts (Phase 3) picks projects automatically.
export const TARGET_SCOPES = ["global", "scoped"] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];
export const DEFAULT_TARGET_SCOPE: TargetScope = "global";

// FluentProject.kind — same two values as TargetScope, named for what it is
// on a project row rather than a ticket's intake-time request.
export const PROJECT_KINDS = TARGET_SCOPES;
export type ProjectKind = TargetScope;

// Ticket.executionTier — REFACTOR_BRIEF Phase 3's decision matrix. Phase 1
// only mirrors targetScope into FLUENT_GLOBAL_APP / FLUENT_SCOPED_APP; the
// other three values aren't produced by any code yet.
export const EXECUTION_TIERS = [
  // Native engine (NATIVE_ENGINE_BRIEF Phase 5+). The router (Phase 6) assigns
  // these; `deployTicket` sends anything starting "NATIVE" to the apply engine.
  "NATIVE_GLOBAL",
  "NATIVE_SCOPED",
  "FLUENT_GLOBAL_APP",
  "FLUENT_SCOPED_APP",
  "FLUENT_FLOW",
  "FLUENT_MOVE_CUSTOMIZE",
  "REST_UPDATE_SET_FALLBACK",
  "NOT_SUPPORTED",
] as const;
export type ExecutionTier = (typeof EXECUTION_TIERS)[number];

export const ARTIFACT_TYPE = {
  REQUIREMENTS: "REQUIREMENTS",
  DESIGN: "DESIGN",
  TASK_LIST: "TASK_LIST",
  CODE: "CODE",
  BUILD_LOG: "BUILD_LOG",
  // Native engine (NATIVE_ENGINE_BRIEF Phase 4): the Developer's output for a
  // native-tier ticket is a validated JSON change plan, and the reviewer
  // approves its rendered field-level diff.
  CHANGE_PLAN: "CHANGE_PLAN",
  CHANGE_PLAN_DIFF: "CHANGE_PLAN_DIFF",
  TEST_PLAN: "TEST_PLAN",
  QA_REPORT: "QA_REPORT",
  DEPLOY_LOG: "DEPLOY_LOG",
  DEPLOY_VERIFICATION: "DEPLOY_VERIFICATION",
  // Native engine Phase 5 (apply / verify / promote).
  PROMOTE_LOG: "PROMOTE_LOG",
  PREVIEW_PROBLEMS: "PREVIEW_PROBLEMS",
  ATF_RESULTS: "ATF_RESULTS",
  INSTANCE_SCAN: "INSTANCE_SCAN",
} as const;
export type ArtifactType = (typeof ARTIFACT_TYPE)[keyof typeof ARTIFACT_TYPE];

// Ticket.releaseGate — the native engine's promotion ladder
// (NATIVE_ENGINE_BRIEF Phase 5). apply.ts sets DEV; promote.ts advances.
export const RELEASE_GATE = {
  DEV: "DEV",
  TEST: "TEST",
  PROD: "PROD",
} as const;
export type ReleaseGate = (typeof RELEASE_GATE)[keyof typeof RELEASE_GATE];

// NativeDeployment.state — lifecycle of one ticket's Table-API deployment.
export const NATIVE_DEPLOY_STATE = {
  APPLYING: "APPLYING",
  APPLIED: "APPLIED",
  APPLY_FAILED: "APPLY_FAILED",
  PROMOTING: "PROMOTING",
  IN_TEST: "IN_TEST",
  IN_PROD: "IN_PROD",
  ROLLED_BACK: "ROLLED_BACK",
} as const;
export type NativeDeployState = (typeof NATIVE_DEPLOY_STATE)[keyof typeof NATIVE_DEPLOY_STATE];
