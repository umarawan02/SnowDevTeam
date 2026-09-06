import { prisma } from "@/lib/db";
import { DEFAULT_TARGET_SCOPE, type TargetScope } from "@/lib/constants";
import { routeTicket, type Route } from "@/lib/pipeline/route";

/**
 * Resolve the execution route for a request (NATIVE_ENGINE_BRIEF §6). Callers
 * that already have the full request text + context should call `routeTicket`
 * themselves and pass the result to `createTicket`; this is the fallback for
 * scripts that only have a title + description.
 */
async function routeFor(input: {
  customerId: string | null;
  instanceId: string | null;
  requestText: string;
}): Promise<Route> {
  if (!input.customerId) {
    return { tier: "NATIVE_GLOBAL", scope: "global", rationale: "No customer context — defaulting to the Global native route.", reused: [] };
  }
  const [customer, scopedApps, instance] = await Promise.all([
    prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true, allowFluentFlows: true } }),
    prisma.fluentProject.findMany({ where: { customerId: input.customerId, kind: "scoped" }, select: { scope: true, name: true } }),
    input.instanceId ? prisma.instance.findUnique({ where: { id: input.instanceId } }) : Promise.resolve(null),
  ]);
  return routeTicket({
    requestText: input.requestText,
    customer: customer ?? { id: input.customerId, allowFluentFlows: false },
    instance,
    scopedApps,
  });
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
  /** Pre-computed route (NATIVE_ENGINE_BRIEF §6). Callers with the full
   *  request text should pass this; otherwise it's derived from title +
   *  description. */
  route?: Route;
}) {
  const targetScope = input.targetScope === "scoped" ? "scoped" : DEFAULT_TARGET_SCOPE;
  return (async () => {
    const route =
      input.route ??
      (await routeFor({
        customerId: input.customerId ?? null,
        instanceId: input.instanceId ?? null,
        requestText: `${input.title}\n\n${input.description}`,
      }));
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
        // A native ticket has no FluentProject; a Fluent ticket does.
        projectId: route.tier.startsWith("FLUENT") ? (input.projectId ?? null) : null,
        executionTier: route.tier,
        tierRationale: route.rationale,
        routeScope: route.scope || null,
      },
    });
  })();
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
