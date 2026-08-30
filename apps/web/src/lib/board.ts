import type { AgentRole, StepStatus, TicketStatus } from "@/lib/constants";

/**
 * The story board is a *live status* view — a request's column is derived from
 * its ticket status and how far the pipeline has run. It is not hand-sortable
 * (the pipeline drives it), so there is no drag-and-drop.
 */
export type BoardColumnId =
  | "INTAKE"
  | "ANALYSIS"
  | "BUILD"
  | "QA"
  | "REVIEW"
  | "DEPLOYING"
  | "DONE"
  | "BLOCKED";

export const BOARD_COLUMNS: { id: BoardColumnId; label: string; hint: string }[] = [
  { id: "INTAKE", label: "Intake", hint: "Queued to start" },
  { id: "ANALYSIS", label: "Analysis & Design", hint: "BA · Architect" },
  { id: "BUILD", label: "Build", hint: "Senior Dev · Developer" },
  { id: "QA", label: "QA", hint: "Static review" },
  { id: "REVIEW", label: "Human review", hint: "Waiting on you" },
  { id: "DEPLOYING", label: "Deploying", hint: "Build & install" },
  { id: "DONE", label: "Deployed", hint: "Live in ServiceNow" },
  { id: "BLOCKED", label: "Blocked", hint: "Failed or rejected" },
];

const ANALYSIS_ROLES: AgentRole[] = ["BA", "ARCHITECT"];
const BUILD_ROLES: AgentRole[] = ["SENIOR_DEV", "DEVELOPER"];

export function columnForTicket(
  status: TicketStatus | string,
  steps: { role: AgentRole | string; status: StepStatus | string }[],
): BoardColumnId {
  switch (status) {
    case "PENDING":
      return "INTAKE";
    case "READY_FOR_REVIEW":
      return "REVIEW";
    case "DEPLOYING":
      return "DEPLOYING";
    case "DEPLOYED":
      return "DONE";
    case "FAILED":
    case "REJECTED":
      return "BLOCKED";
    case "RUNNING": {
      const running = steps.find((s) => s.status === "RUNNING");
      const role = (running?.role ?? lastTouchedRole(steps)) as AgentRole | undefined;
      if (role && (BUILD_ROLES as string[]).includes(role)) return "BUILD";
      if (role === "QA") return "QA";
      if (role && (ANALYSIS_ROLES as string[]).includes(role)) return "ANALYSIS";
      return "ANALYSIS";
    }
    default:
      return "INTAKE";
  }
}

function lastTouchedRole(steps: { role: AgentRole | string; status: StepStatus | string }[]) {
  const done = steps.filter((s) => s.status === "COMPLETE");
  return done.length ? done[done.length - 1].role : undefined;
}
