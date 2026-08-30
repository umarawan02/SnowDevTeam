import type { ReactNode } from "react";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { instanceLabel } from "@/lib/instance";
import type { CurrentUser } from "@/lib/auth/current-user";

export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  return (
    <div className="appwrap">
      <SideNav role={user.role} />
      <div style={{ minWidth: 0 }}>
        <TopBar instance={instanceLabel()} user={user} />
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
