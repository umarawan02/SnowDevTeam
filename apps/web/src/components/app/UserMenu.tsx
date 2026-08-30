"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { roleMeta, canManageUsers } from "@/lib/auth/rbac";
import type { CurrentUser } from "@/lib/auth/current-user";

function initials(u: CurrentUser): string {
  const base = (u.name || u.email).trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function UserMenu({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const rm = roleMeta(user.role);

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

  const h = hue(user.email);

  return (
    <div className="usermenu" ref={ref}>
      <button
        type="button"
        className="um-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="um-avatar"
          style={{ background: `linear-gradient(140deg, hsl(${h} 65% 52%), hsl(${(h + 40) % 360} 70% 45%))` }}
        >
          {initials(user)}
        </span>
      </button>

      {open && (
        <div className="um-pop" role="menu">
          <div className="um-head">
            <div className="um-name">{user.name || user.email}</div>
            <div className="um-sub">{user.email}</div>
            <span className="chip accent" style={{ marginTop: 6 }}>
              {rm.label}
            </span>
          </div>
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
    </div>
  );
}
