import { prisma } from "@/lib/db";
import { AGENT_ROLES, type AgentRole } from "@/lib/constants";
import { roleMeta } from "@/lib/ui";

// MVP scale: a handful of tickets. Pull everything and aggregate in JS rather
// than pushing many small grouped queries at SQLite.

export interface DashboardMetrics {
  totals: {
    requests: number;
    running: number;
    awaitingReview: number;
    deployed: number;
    failed: number;
    rejected: number;
  };
  avgRunMs: number | null;
  totalCostUsd: number;
  costTracked: boolean;
  throughput: { label: string; count: number }[];
  stageTiming: { role: AgentRole; label: string; avgMs: number; runs: number }[];
  funnel: { role: AgentRole; label: string; reached: number }[];
  costByRole: { role: AgentRole; label: string; costUsd: number }[];
  reviewQueue: { id: string; title: string; createdAt: string }[];
  activity: { id: string; text: string; tone: "ok" | "crit" | "accent" | "idle"; at: string }[];
}

const DAY = 86_400_000;

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const tickets = await prisma.ticket.findMany({
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });

  const totals = {
    requests: tickets.length,
    running: 0,
    awaitingReview: 0,
    deployed: 0,
    failed: 0,
    rejected: 0,
  };
  for (const t of tickets) {
    if (t.status === "RUNNING" || t.status === "PENDING" || t.status === "DEPLOYING") totals.running++;
    else if (t.status === "READY_FOR_REVIEW") totals.awaitingReview++;
    else if (t.status === "DEPLOYED") totals.deployed++;
    else if (t.status === "FAILED") totals.failed++;
    else if (t.status === "REJECTED") totals.rejected++;
  }

  // Average compute time of a completed run — the sum of its stage durations
  // (wall-clock start→end can be inflated by resumes / rate-limit waits).
  const runDurations: number[] = [];
  for (const t of tickets) {
    if (!["READY_FOR_REVIEW", "DEPLOYED", "REJECTED"].includes(t.status)) continue;
    const done = t.steps.filter((s) => s.status === "COMPLETE" && s.startedAt && s.completedAt);
    if (done.length < 3) continue;
    runDurations.push(
      done.reduce((sum, s) => sum + (s.completedAt!.getTime() - s.startedAt!.getTime()), 0),
    );
  }
  const avgRunMs = runDurations.length
    ? Math.round(runDurations.reduce((a, b) => a + b, 0) / runDurations.length)
    : null;

  // Cost.
  let totalCostUsd = 0;
  let costRows = 0;
  const costByRoleMap = new Map<string, number>();
  for (const t of tickets) {
    for (const s of t.steps) {
      if (typeof s.costUsd === "number") {
        totalCostUsd += s.costUsd;
        costRows++;
        costByRoleMap.set(s.role, (costByRoleMap.get(s.role) ?? 0) + s.costUsd);
      }
    }
  }

  // Throughput — requests created per day, last 14 days.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const throughput = Array.from({ length: 14 }, (_, i) => {
    const start = today.getTime() - (13 - i) * DAY;
    const end = start + DAY;
    const count = tickets.filter((t) => {
      const c = t.createdAt.getTime();
      return c >= start && c < end;
    }).length;
    const d = new Date(start);
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, count };
  });

  // Per-stage timing + funnel.
  const stageTiming: DashboardMetrics["stageTiming"] = [];
  const funnel: DashboardMetrics["funnel"] = [];
  for (const role of AGENT_ROLES) {
    const steps = tickets.flatMap((t) => t.steps.filter((s) => s.role === role));
    const done = steps.filter((s) => s.status === "COMPLETE" && s.startedAt && s.completedAt);
    const durs = done.map((s) => s.completedAt!.getTime() - s.startedAt!.getTime());
    stageTiming.push({
      role,
      label: roleMeta(role).label,
      avgMs: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
      runs: done.length,
    });
    funnel.push({ role, label: roleMeta(role).label, reached: steps.filter((s) => s.status === "COMPLETE").length });
  }

  const costByRole = AGENT_ROLES.map((role) => ({
    role,
    label: roleMeta(role).label,
    costUsd: costByRoleMap.get(role) ?? 0,
  }));

  const reviewQueue = tickets
    .filter((t) => t.status === "READY_FOR_REVIEW")
    .map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt.toISOString() }));

  // Activity feed — most recent step transitions.
  const events = tickets
    .flatMap((t) =>
      t.steps
        .filter((s) => s.status === "COMPLETE" || s.status === "FAILED" || s.status === "RUNNING")
        .map((s) => ({
          id: s.id,
          at: (s.completedAt ?? s.startedAt ?? s.updatedAt).toISOString(),
          sortAt: (s.completedAt ?? s.startedAt ?? s.updatedAt).getTime(),
          text:
            s.status === "COMPLETE"
              ? `${roleMeta(s.role).label} finished · ${t.title}`
              : s.status === "FAILED"
                ? `${roleMeta(s.role).label} failed · ${t.title}`
                : `${roleMeta(s.role).label} running · ${t.title}`,
          tone: (s.status === "COMPLETE" ? "ok" : s.status === "FAILED" ? "crit" : "accent") as
            | "ok"
            | "crit"
            | "accent"
            | "idle",
        })),
    )
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, 12)
    .map((e) => ({ id: e.id, text: e.text, tone: e.tone, at: e.at }));

  return {
    totals,
    avgRunMs,
    totalCostUsd,
    costTracked: costRows > 0,
    throughput,
    stageTiming,
    funnel,
    costByRole,
    reviewQueue,
    activity: events,
  };
}
