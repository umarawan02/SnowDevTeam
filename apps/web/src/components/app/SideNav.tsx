"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconDashboard, IconBoard, IconAgents, IconUsers, IconPlus } from "./icons";
import { canManageUsers } from "@/lib/auth/rbac";
import { SidebarUser } from "./SidebarUser";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { ConversationSummaryJson } from "@/lib/types";

const NAV = [
  { href: "/", label: "Dashboard", Icon: IconDashboard, match: (p: string) => p === "/" },
  { href: "/board", label: "Story board", Icon: IconBoard, match: (p: string) => p.startsWith("/board") || p.startsWith("/tickets") },
  { href: "/agents", label: "Agents", Icon: IconAgents, match: (p: string) => p.startsWith("/agents") },
];

export function SideNav({
  user,
  conversations,
}: {
  user: CurrentUser;
  conversations: ConversationSummaryJson[];
}) {
  const pathname = usePathname() || "/";
  const nav = canManageUsers(user)
    ? [...NAV, { href: "/settings/users", label: "Users", Icon: IconUsers, match: (p: string) => p.startsWith("/settings/users") }]
    : NAV;

  const activeId = pathname.startsWith("/intake/") ? pathname.split("/")[2] : null;

  return (
    <nav className="sidebar" aria-label="Primary">
      <Link href="/" className="mark" style={{ textDecoration: "none" }}>
        <span className="glyph">S</span>
        <span className="wm">
          SnowDevTeam
          <small>AI delivery team</small>
        </span>
      </Link>

      <Link href="/intake" className="newbtn">
        <IconPlus />
        New request
      </Link>

      <div className="navgroup">
        {nav.map(({ href, label, Icon, match }) => (
          <Link key={href} href={href} className="navlink" aria-current={match(pathname) ? "page" : undefined}>
            <Icon />
            {label}
          </Link>
        ))}
      </div>

      <div className="convsection">
        <div className="convhead">
          <span>Conversations</span>
          <Link href="/intake" aria-label="New conversation" className="convadd">
            <IconPlus />
          </Link>
        </div>
        <div className="convlist">
          {conversations.length === 0 && <span className="convempty">No requests yet</span>}
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={c.status === "BUILDING" && c.ticketId ? `/tickets/${c.ticketId}` : `/intake/${c.id}`}
              className="convlink"
              aria-current={activeId === c.id ? "page" : undefined}
            >
              <span className={`convdot ${c.status === "BUILDING" ? "building" : ""}`} />
              <span className="convtitle">{c.title}</span>
            </Link>
          ))}
        </div>
      </div>

      <SidebarUser user={user} />
    </nav>
  );
}
