import type { ReactNode } from "react";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { instanceLabel } from "@/lib/instance";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="appwrap">
      <SideNav />
      <div style={{ minWidth: 0 }}>
        <TopBar instance={instanceLabel()} />
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
