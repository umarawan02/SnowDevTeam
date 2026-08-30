"use client";

import { useState } from "react";
import { USER_ROLES, roleMeta } from "@/lib/auth/rbac";
import { relativeTime } from "@/lib/ui";
import { AddUserDialog } from "./AddUserDialog";
import type { AdminUserJson } from "@/lib/types";

export function UserTable({
  initialUsers,
  currentUserId,
}: {
  initialUsers: AdminUserJson[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ email: string; tempPassword: string } | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Update failed (${res.status})`);
      setUsers((list) => list.map((u) => (u.id === id ? { ...u, ...data.user } : u)));
      if (data.tempPassword) setFlash({ email: data.user.email, tempPassword: data.tempPassword });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="glass panel">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.98rem", fontWeight: 600 }}>
          {users.length} {users.length === 1 ? "user" : "users"}
        </h3>
        <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>
          Add user
        </button>
      </div>

      {error && <p className="formerr" style={{ marginBottom: 12 }}>{error}</p>}
      {flash && (
        <div className="temppw">
          Temporary password for <b>{flash.email}</b>: <code>{flash.tempPassword}</code>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="utable-wrap">
        <table className="utable">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Activity</th>
              <th>Last seen</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === currentUserId;
              return (
                <tr key={u.id} className={u.active ? "" : "inactive"}>
                  <td>
                    <div className="u-name">{u.name || "—"} {isMe && <span className="u-you">you</span>}</div>
                    <div className="u-email">{u.email}</div>
                  </td>
                  <td>
                    <select
                      value={u.role}
                      disabled={busyId === u.id || isMe}
                      onChange={(e) => patch(u.id, { role: e.target.value })}
                      className="u-role"
                      title={isMe ? "You can't change your own role" : roleMeta(u.role).blurb}
                    >
                      {USER_ROLES.map((r) => (
                        <option key={r} value={r}>{roleMeta(r).label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="u-dim">
                    {u._count.createdTickets} submitted · {u._count.reviewedTickets} reviewed
                  </td>
                  <td className="u-dim">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : "never"}</td>
                  <td>
                    <button
                      type="button"
                      className={`u-toggle ${u.active ? "on" : "off"}`}
                      disabled={busyId === u.id || isMe}
                      onClick={() => patch(u.id, { active: !u.active })}
                      title={isMe ? "You can't deactivate yourself" : ""}
                    >
                      {u.active ? "Active" : "Disabled"}
                    </button>
                    {!isMe && (
                      <button
                        type="button"
                        className="u-reset"
                        disabled={busyId === u.id}
                        onClick={() => patch(u.id, { resetPassword: true })}
                      >
                        Reset password
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onCreated={(user, tempPassword) => {
            setUsers((list) => [
              ...list,
              { ...user, lastLoginAt: null, createdAt: new Date().toISOString(), _count: { createdTickets: 0, reviewedTickets: 0 } },
            ]);
            setFlash({ email: user.email, tempPassword });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
