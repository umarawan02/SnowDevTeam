import { prisma } from "@/lib/db";

export function createTicket(input: { title: string; description: string }) {
  return prisma.ticket.create({
    data: {
      title: input.title.trim(),
      description: input.description.trim(),
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
