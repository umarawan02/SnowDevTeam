import { prisma } from "@/lib/db";

export function createTicket(input: {
  title: string;
  description: string;
  requester?: string | null;
  priority?: string | null;
  category?: string | null;
  createdById?: string | null;
}) {
  return prisma.ticket.create({
    data: {
      title: input.title.trim(),
      description: input.description.trim(),
      requester: input.requester ?? null,
      priority: input.priority ?? null,
      category: input.category ?? null,
      createdById: input.createdById ?? null,
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
    },
  });
}
