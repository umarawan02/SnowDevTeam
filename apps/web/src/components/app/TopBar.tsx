"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { IconPlus } from "./icons";

function sectionLabel(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/intake")) return "New request";
  if (pathname.startsWith("/board")) return "Story board";
  if (pathname.startsWith("/agents")) return "Agents";
  if (pathname.startsWith("/tickets")) return "Run detail";
  if (pathname.startsWith("/settings/users")) return "User management";
  return "SnowDevTeam";
}

export function TopBar({ instance }: { instance: string }) {
  const pathname = usePathname() || "/";
  const onIntake = pathname.startsWith("/intake");

  return (
    <header className="appbar">
      <div className="bcrumb">
        <b>{sectionLabel(pathname)}</b>
      </div>
      <span className="spacer" />
      <span className="inst" title="Target ServiceNow instance">
        <span className="d" />
        {instance}
      </span>
      {!onIntake && (
        <Link href="/intake" className="btn sm">
          <IconPlus />
          New request
        </Link>
      )}
      <ThemeToggle />
    </header>
  );
}
