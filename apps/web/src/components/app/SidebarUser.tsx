"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { roleMeta, canManageUsers } from "@/lib/auth/rbac";
import type { CurrentUser } from "@/lib/auth/current-user";

function initials(u: CurrentUser) {
  const base = (u.name || u.email).trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function hue(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function SidebarUser({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const rm = roleMeta(user.role);
  const h = hue(user.email);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="sbuser" ref={ref}>
      {open && (
        <div className="sbuser-pop" role="menu">
          {canManageUsers(user) && (
            <Link href="/settings/users" className="um-item" role="menuitem" onClick={() => setOpen(false)}>
              User management
            </Link>
          )}
          <button type="button" className="um-item danger" role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
      <button type="button" className="sbuser-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span
          className="sbuser-av"
          style={{ background: `linear-gradient(140deg, hsl(${h} 70% 52%), hsl(${(h + 44) % 360} 72% 46%))` }}
        >
          {initials(user)}
        </span>
        <span className="sbuser-meta">
          <span className="sbuser-name">{user.name || user.email}</span>
          <span className="sbuser-role">{rm.label}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
