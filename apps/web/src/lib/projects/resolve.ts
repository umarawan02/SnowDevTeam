import path from "node:path";
import { prisma } from "@/lib/db";
import { WORKSPACES_ROOT } from "@/lib/config";
import { DEFAULT_TARGET_SCOPE, type TargetScope } from "@/lib/constants";

/**
 * Request-path project resolution (REFACTOR_BRIEF Phase 1) — the lightweight
 * half of the projects module. No `fs` / `child_process`, so it's safe to
 * import from API route handlers. Provisioning (scaffold / import / npm
 * install / git) lives in `./provision`.
 */

export interface ProjectContext {
  id: string;
  /** Absolute path on disk. */
  repoPath: string;
  scope: string;
  scopeId: string;
  kind: TargetScope;
  /** The branch a deployed ticket is rebuilt onto (Phase 2). */
  defaultBranch: string;
}

type ProjectRow = {
  id: string;
  repoPath: string;
  scope: string;
  scopeId: string;
  kind: string;
  defaultBranch: string;
};

/** A FluentProject row → the absolute-path shape the pipeline/deploy/mcp layers use. */
export function toProjectContext(project: ProjectRow): ProjectContext {
  return {
    id: project.id,
    repoPath: path.isAbsolute(project.repoPath) ? project.repoPath : path.join(WORKSPACES_ROOT, project.repoPath),
    scope: project.scope,
    scopeId: project.scopeId,
    kind: project.kind === "scoped" ? "scoped" : DEFAULT_TARGET_SCOPE,
    defaultBranch: project.defaultBranch || "main",
  };
}

/**
 * Phase 1 stand-in for `tier.ts` (Phase 3): looks up the customer's one
 * FluentProject of the requested kind. No auto-creation on the request path —
 * a customer's projects are provisioned ahead of time (`provision.ts`,
 * typically via the seed script or an admin action), so a ticket that can't
 * find one fails loudly instead of silently building against the wrong app.
 */
export async function resolveProjectForTicket(input: {
  customerId: string;
  kind: TargetScope;
}): Promise<{ id: string; instanceId: string | null }> {
  const project = await prisma.fluentProject.findFirst({
    where: { customerId: input.customerId, kind: input.kind },
    orderBy: { createdAt: "asc" },
  });
  if (!project) {
    throw new Error(
      `No ${input.kind} FluentProject registered for customer ${input.customerId}. ` +
        `Provision one first before submitting a ${input.kind} ticket.`,
    );
  }
  return { id: project.id, instanceId: project.instanceId };
}

/** The one customer seeded in Phase 1 — every intake path resolves against
 *  it until real multi-customer routing (choosing *which* customer) exists. */
export const DEMO_CUSTOMER_SLUG = "demo";

export async function getDefaultCustomerId(): Promise<string> {
  const customer = await prisma.customer.findUnique({ where: { slug: DEMO_CUSTOMER_SLUG } });
  if (!customer) {
    throw new Error(`No customer with slug "${DEMO_CUSTOMER_SLUG}" — run scripts/seed-demo-customer.mts first.`);
  }
  return customer.id;
}
