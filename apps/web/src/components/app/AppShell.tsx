import type { ReactNode } from "react";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { instanceLabel } from "@/lib/instance";
import { getIntakeConversations } from "@/lib/intake/store";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { ConversationSummaryJson } from "@/lib/types";

export async function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const rows = await getIntakeConversations(user.id);
  const conversations: ConversationSummaryJson[] = rows.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    ticketId: c.ticketId,
  }));

  return (
    <div className="appwrap">
      <SideNav user={user} conversations={conversations} />
      <div style={{ minWidth: 0 }}>
        <TopBar instance={instanceLabel()} />
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
