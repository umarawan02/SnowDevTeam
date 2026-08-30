"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconDashboard, IconIntake, IconBoard, IconAgents, IconUsers } from "./icons";
import { canManageUsers } from "@/lib/auth/rbac";

const LINKS = [
  { href: "/", label: "Dashboard", Icon: IconDashboard, match: (p: string) => p === "/" },
  { href: "/intake", label: "Intake", Icon: IconIntake, match: (p: string) => p.startsWith("/intake") },
  { href: "/board", label: "Board", Icon: IconBoard, match: (p: string) => p.startsWith("/board") || p.startsWith("/tickets") },
  { href: "/agents", label: "Agents", Icon: IconAgents, match: (p: string) => p.startsWith("/agents") },
];

export function SideNav({ role }: { role: string }) {
  const pathname = usePathname() || "/";
  const links = canManageUsers({ role })
    ? [...LINKS, { href: "/settings/users", label: "Users", Icon: IconUsers, match: (p: string) => p.startsWith("/settings/users") }]
    : LINKS;

  return (
    <nav className="sidebar" aria-label="Primary">
      <Link href="/" className="mark" style={{ textDecoration: "none" }}>
        <span className="glyph">S</span>
        <span className="wm">
          SnowDevTeam
          <small>AI delivery team</small>
        </span>
      </Link>
      {links.map(({ href, label, Icon, match }) => (
        <Link
          key={href}
          href={href}
          className="navlink"
          aria-current={match(pathname) ? "page" : undefined}
        >
          <Icon />
          {label}
        </Link>
      ))}
      <span className="navspace" />
      <p className="foot">Every run is reviewed by a human before anything reaches ServiceNow.</p>
    </nav>
  );
}
