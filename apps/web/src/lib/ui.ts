import type { AgentRole, ArtifactType, StepStatus, TicketStatus } from "@/lib/constants";

// Display metadata for the UI. Client-safe: depends only on the string-literal
// types in constants.ts, never on agents/roles.ts (which loads prompt files off
// disk via `fs`).

export type Tone = "idle" | "ok" | "accent" | "crit";

export const TICKET_STATUS_META: Record<TicketStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "idle" },
  RUNNING: { label: "Running", tone: "idle" },
  READY_FOR_REVIEW: { label: "Ready for review", tone: "accent" },
  FAILED: { label: "Failed", tone: "crit" },
  DEPLOYED: { label: "Deployed", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "crit" },
};

export const STEP_STATUS_META: Record<StepStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "idle" },
  RUNNING: { label: "Running", tone: "idle" },
  COMPLETE: { label: "Complete", tone: "ok" },
  FAILED: { label: "Failed", tone: "crit" },
};

export const ROLE_META: Record<
  AgentRole,
  { label: string; short: string; order: number; artifactType: ArtifactType }
> = {
  BA: { label: "Business Analyst", short: "BA", order: 0, artifactType: "REQUIREMENTS" },
  ARCHITECT: { label: "Architect", short: "Architect", order: 1, artifactType: "DESIGN" },
  SENIOR_DEV: { label: "Senior Developer", short: "Sr Dev", order: 2, artifactType: "TASK_LIST" },
  DEVELOPER: { label: "Developer", short: "Developer", order: 3, artifactType: "CODE" },
  QA: { label: "QA", short: "QA", order: 4, artifactType: "QA_REPORT" },
};

export const ARTIFACT_META: Record<ArtifactType, { label: string; role: AgentRole }> = {
  REQUIREMENTS: { label: "Requirements", role: "BA" },
  DESIGN: { label: "Design (ADR)", role: "ARCHITECT" },
  TASK_LIST: { label: "Task List", role: "SENIOR_DEV" },
  CODE: { label: "Code", role: "DEVELOPER" },
  TEST_PLAN: { label: "Test Plan", role: "QA" },
  QA_REPORT: { label: "QA Report", role: "QA" },
  DEPLOY_LOG: { label: "Deploy Log", role: "QA" },
  DEPLOY_VERIFICATION: { label: "Deploy Verification", role: "QA" },
};

/** Artifact types shown as pipeline-output tabs, in pipeline order. */
export const ARTIFACT_TAB_ORDER: ArtifactType[] = [
  "REQUIREMENTS",
  "DESIGN",
  "TASK_LIST",
  "CODE",
  "QA_REPORT",
];

export const TERMINAL_TICKET_STATUSES: TicketStatus[] = [
  "READY_FOR_REVIEW",
  "FAILED",
  "DEPLOYED",
  "REJECTED",
];

export function isTerminal(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as string[]).includes(status);
}

// Boundary-safe lookups: Prisma types these columns as plain `string`.
export function ticketStatusMeta(status: string): { label: string; tone: Tone } {
  return TICKET_STATUS_META[status as TicketStatus] ?? { label: status, tone: "idle" };
}
export function stepStatusMeta(status: string): { label: string; tone: Tone } {
  return STEP_STATUS_META[status as StepStatus] ?? { label: status, tone: "idle" };
}
export function roleMeta(role: string) {
  return (
    ROLE_META[role as AgentRole] ?? {
      label: role,
      short: role,
      order: 99,
      artifactType: "REQUIREMENTS" as ArtifactType,
    }
  );
}

export function relativeTime(iso: string | Date): string {
  const then = new Date(iso).getTime();
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function durationLabel(startedAt?: string | Date | null, completedAt?: string | Date | null): string {
  if (!startedAt || !completedAt) return "";
  const sec = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return sec >= 90 ? `${Math.round(sec / 60)}m ${sec % 60}s` : `${sec}s`;
}
