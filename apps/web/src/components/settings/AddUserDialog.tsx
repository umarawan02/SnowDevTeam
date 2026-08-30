"use client";

import { useState } from "react";
import { USER_ROLES, roleMeta } from "@/lib/auth/rbac";

interface CreatedUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
}

export function AddUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: CreatedUser, tempPassword: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("REQUESTER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      onCreated(data.user, data.tempPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="h2" style={{ marginBottom: 4 }}>Add a user</h3>
        <p className="lede" style={{ marginTop: 0, marginBottom: 18 }}>
          They&rsquo;ll sign in with a one-time password shown after you create the account.
        </p>
        <form onSubmit={submit} className="editform" style={{ maxWidth: "none" }}>
          <div className="field">
            <label htmlFor="au-email">Work email</label>
            <input id="au-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="au-name">Name</label>
            <input id="au-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="au-role">Role</label>
            <select id="au-role" value={role} onChange={(e) => setRole(e.target.value)}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>{roleMeta(r).label} — {roleMeta(r).blurb}</option>
              ))}
            </select>
          </div>
          {error && <p className="formerr">{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" type="submit" disabled={busy || !email}>
              {busy ? "Creating…" : "Create user"}
            </button>
            <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
