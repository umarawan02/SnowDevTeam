import { prisma } from "@/lib/db";

export interface ConversationSummary {
  id: string;
  title: string;
  status: string;
  ticketId: string | null;
  updatedAt: Date;
}

/** Recent conversations for the sidebar. */
export function getIntakeConversations(userId: string, take = 12): Promise<ConversationSummary[]> {
  return prisma.intakeConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, title: true, status: true, ticketId: true, updatedAt: true },
  });
}

/** Load one conversation with its messages — only if `userId` owns it. */
export function getConversation(id: string, userId: string) {
  return prisma.intakeConversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export function createConversation(userId: string) {
  return prisma.intakeConversation.create({ data: { userId } });
}

/** The user's most recent conversation still gathering requirements, if any. */
export function latestGathering(userId: string) {
  return prisma.intakeConversation.findFirst({
    where: { userId, status: "GATHERING" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
}
