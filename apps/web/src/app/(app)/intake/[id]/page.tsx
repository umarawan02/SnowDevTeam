import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getConversation } from "@/lib/intake/store";
import { extractReadyBlock } from "@/lib/intake/parse";
import { IntakeChat } from "@/components/intake/IntakeChat";
import type { IntakeConversationJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function IntakeConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const c = await getConversation(id, user.id);
  if (!c) notFound();

  const conversation: IntakeConversationJson = {
    id: c.id,
    title: c.title,
    status: c.status,
    ticketId: c.ticketId,
    messages: c.messages.map((m) => {
      const { visible, ready } =
        m.role === "assistant"
          ? extractReadyBlock(m.content)
          : { visible: m.content, ready: null };
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: visible,
        ready,
        createdAt: m.createdAt.toISOString(),
      };
    }),
  };

  return <IntakeChat conversation={conversation} userName={user.name ?? user.email} />;
}
