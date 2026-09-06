import { prisma } from "@/lib/db";
import { DEFAULT_TARGET_SCOPE, type TargetScope } from "@/lib/constants";

/** Ticket.executionTier — a direct mirror of targetScope for now (Phase 1);
 *  tier.ts (Phase 3) makes this a real decision. */
function tierFor(scope: TargetScope): string {
  return scope === "scoped" ? "FLUENT_SCOPED_APP" : "FLUENT_GLOBAL_APP";
}

export function createTicket(input: {
  title: string;
  description: string;
  requester?: string | null;
  priority?: string | null;
  category?: string | null;
  targetScope?: TargetScope | null;
  createdById?: string | null;
  // Multi-customer model (REFACTOR_BRIEF Phase 1) — all optional so scripts
  // and callers that haven't been migrated to a customer yet still work.
  customerId?: string | null;
  instanceId?: string | null;
  projectId?: string | null;
}) {
  const targetScope = input.targetScope === "scoped" ? "scoped" : DEFAULT_TARGET_SCOPE;
  return prisma.ticket.create({
    data: {
      title: input.title.trim(),
      description: input.description.trim(),
      requester: input.requester ?? null,
      priority: input.priority ?? null,
      category: input.category ?? null,
      targetScope,
      createdById: input.createdById ?? null,
      customerId: input.customerId ?? null,
      instanceId: input.instanceId ?? null,
      projectId: input.projectId ?? null,
      executionTier: input.projectId ? tierFor(targetScope) : null,
      // status defaults to PENDING
    },
  });
}

export function listTickets() {
  return prisma.ticket.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      requester: true,
      category: true,
      targetScope: true,
      reworkRound: true,
      createdAt: true,
      updatedAt: true,
      steps: {
        select: { role: true, status: true, order: true },
        orderBy: { order: "asc" },
      },
    },
  });
}

export function getTicketWithSteps(id: string) {
  return prisma.ticket.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { order: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" } },
      nativeDeployment: true,
    },
  });
}
